var fs = require('fs')
var sqlite3 = require('sqlite3').verbose()
var restify = require('restify')
var Promise = require('bluebird')
var restifyValidation = require('node-restify-validation')

var file = 'vms.db'
var db = new sqlite3.Database(file)

var server = restify.createServer()
server.use(restify.fullResponse())
server.use(restify.bodyParser({
    mapParams: true
}))
server.use(restify.queryParser())
server.use(restifyValidation.validationPlugin({
    errorsAsArray: true,
    forbidUndefinedVariables: false,
    errorHandler: restify.errors.InvalidArgumentError
}))

server.use(
    function crossOrigin(req, res, next) {
        res.header('Access-Control-Allow-Origin', '*')
        res.header('Access-Control-Allow-Headers', 'X-Requested-With')
        return next()
    }
)

function parseDatabaseRow(row) {
    var ansibleFacts
    try {
        ansibleFacts = JSON.parse(row.ansible_facts)
    } catch (e) {
        console.log('Could not parse ansible_facts from database: ' + e)
    }
    var systeminfo
    try {
        systeminfo = JSON.parse(row.systeminfo)
    } catch (e) {
        console.log('Could not parse systeminfo from database: ' + e)
    }
    var result = {
        id: row.id,
        host: row.host,
        status: row.status,
        description: row.description,
        contact: row.contact,
        systeminfo: systeminfo,
        bookingtime: row.bookingtime,
        ansible_facts: ansibleFacts,
    }
    return result
}

server.get('/vms', function(req, res, next) {
    db.serialize(function() {
        var vms = []
        db.each('SELECT * FROM vms ORDER BY host', function(err, row) {
            if (err) {
                console.log('Database error: ' + err)
                res.status(500)
                res.json({message: err})
            }
            vms.push(parseDatabaseRow(row))
        }, function(err, numRows) {
            if (err) {
                res.status(500)
                res.json({message: err})
            }
            res.json({
                vms: vms
            })
        })
    })
})

server.post('/vms', function(req, res, next) {
    // TODO validation...
    var vms = req.body
    console.log(vms)
    var promises = []
    for (index in vms) {
        var params = [ vms[index].host, vms[index].status ]
        console.log(params)
        promises.push(promDb.runAsync("INSERT OR REPLACE INTO vms (host, status) VALUES (?, ?)", params))
    }
    Promise.all(promises).then(function() {
        res.send(204, { status: 'ok' })
    }).catch(function(e) {
        res.send(400, { status: 'error', cause: e })
    })
})

server.get('/vms/:host', function(req, res, next) {
    db.serialize(function() {
        var vm = {}
        var queryHost = req.params.host
        var selectStmt = 'SELECT * FROM vms WHERE host = (?)'
        var params = [ queryHost ]
        db.get(selectStmt, params, function(err, row) {
            vm = parseDatabaseRow(row)
            res.json(vm)
        })
    })
})

server.put('/vms/:id', function(req, res, next) {
    var id = req.params.id
    var vm = req.body

    var sid = vm.id
    var host = vm.host
    var status = vm.status
    var description = vm.description
    var contact = vm.contact
    var bookingtime = vm.bookingtime

    if (sid != 'undefined' && sid == id) {
        if (host != 'undefined' && status != 'undefined' && description != 'undefined' && contact != 'undefined') {
            var updateStmt = db.prepare('UPDATE vms SET host=(?), status=(?), description=(?), contact=(?), bookingtime=(?) WHERE id=(?)')
            updateStmt.run(host, status, description, contact, bookingtime, id, function(err) {
                if (err != null) {
                    console.log('Error when updating vm: ' + err)
                    res.status(400)
                } else {
                    res.status(204)
                }
                res.end()
            })
        }
    } else {
        res.status(400)
        res.end()
    }
})

server.put('/vms', function(req, res, next) {
    var payload = req.body
    if (payload) {
        var systeminfo = {
            epages_version: payload['epages_version'],
            epages_j_version: payload['epages_j_version'],
            epages_unity_version: payload['epages_unity_version']
        }
        var host = payload['ansible_fqdn']
        var factsAsString = JSON.stringify(payload)

        delete factsAsString.get_version
        delete factsAsString.get_j_version
        delete factsAsString.get_unity_version

        var systeminfoAsString = JSON.stringify(systeminfo)
        var updateStmt = db.prepare('UPDATE vms SET ansible_facts=(?), systeminfo=(?) WHERE host=(?)')
        updateStmt.run(factsAsString, systeminfoAsString, host, function(err) {
            if (err != null) {
                console.log('Error when updating vm: ' + err)
                res.status(400)
            } else {
                res.status(204)
            }
            res.end()
        })
    } else {
        res.status(400)
        res.end()
    }
})

var promDb = Promise.promisifyAll(db)

server.post({
    url: '/vms/reservation',
    validation: {
        content: {
            contact: {
                isRequired: true
            },
            requireExternal: {
                isRequired: false
            }
        }
    }}, function(req, res, next) {
        db.serialize(function() {
            var payload = req.body
            var findQuery = "SELECT id, host FROM vms WHERE status == 'free'";
            if (payload.requireExternal == 'true') {
                console.log('Received request for external VM')
                findQuery += "AND substr(host, -7, 7) = 'systems'"
            }
            promDb.getAsync(findQuery).then(function(vm) {
                if (vm) {
                    console.log('Booking VM ' + vm.host + '.')

                    var params = [
                        'in use',
                        payload.contact,
                        new Date().toISOString(),
                        payload.description,
                        vm.id
                    ]
                    promDb.runAsync("UPDATE vms SET status=(?), contact=(?), bookingtime=(?), description=(?) WHERE id=(?)", params).then(function() {
                        res.send(201, {
                            id: vm.id,
                            host: vm.host,
                            status: 'in use'
                        })
                    })
                } else {
                    var msg = 'All ' + (payload.requireExternal ? 'external' : '') + ' VMs are booked!'
                    console.error(msg)
                    res.send(423, { message: msg })
                }
            })
        })
    }
)

server.del({
    url: '/vms/:host/reservation',
    validation: {
        resources: {
            host: { isRequired: true }
        },
    }}, function(req, res, next) {
        promDb.runAsync("UPDATE vms SET status='free', contact='', bookingtime='', description='' WHERE host=(?)", req.params.host)
            .then(function() {
                res.send(200, {
                    host: req.params.host,
                    status: 'free'
                })
            }).catch(function(err) {
                var msg = 'Error when releasing VM reservation for ' + req.params.host + ': ' + err
                console.error(msg)
                res.send(500, { message: msg })
            })
    }
)

var port = 3000
server.listen(port, function(err) {
    if (err) {
        console.error(err)
        return 1
    } else {
        return 0
    }
})
