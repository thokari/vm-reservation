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
                console.log('Database error', err)
                res.status(500)
                res.json({ message: err })
            }
            vms.push(parseDatabaseRow(row))
        }, function(err, numRows) {
            if (err) {
                res.status(500)
                res.json({ message: err })
            }
            res.json(vms)
        })
    })
})

server.post('/vms', function(req, res, next) {
    // TODO validation...
    var vms = req.body
    var promises = []
    console.log('Attempting to update vms', vms)
    for (index in vms) {
        var params = [ vms[index].host, vms[index].status ]
        promises.push(promDb.runAsync("INSERT OR REPLACE INTO vms (host, status) VALUES (?, ?)", params))
    }
    Promise.all(promises).then(function() {
        res.send(204)
    }).catch(function(e) {
        res.send(400, { status: 'error', cause: e.message })
    })
})

server.del('/vms/:host', function(req, res, next) {
    console.log('Deleting VM', req.params.host)
    var query = 'DELETE FROM vms WHERE host = (?)'
    promDb.runAsync(query, req.params.host).then(function() {
        res.send(204)
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

server.put('/vms/:host', function(req, res, next) {
    var hostParam = req.params.host
    var vm = req.body

    var host = vm.host
    var status = vm.status
    var description = vm.description
    var contact = vm.contact
    var bookingtime = vm.bookingtime

    if (host != 'undefined' && status != 'undefined' && description != 'undefined' && contact != 'undefined') {
        var updateStmt = db.prepare('UPDATE vms SET host=(?), status=(?), description=(?), contact=(?), bookingtime=(?) WHERE host=(?)')
        updateStmt.run(host, status, description, contact, bookingtime, hostParam, function(err) {
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

server.put('/vms/:host/facts', function(req, res, next) {
    var payload = req.body
    if (payload) {
        var systeminfo = {
            epages_version: payload['epages_version'],
            epages_j_version: payload['epages_j_version'],
            epages_unity_version: payload['epages_unity_version']
        }
        var host = req.params.host
        console.log('Received fact update for host ' + host + ', facts:', payload.ansible_distribution + ', ' + payload.ansible_memtotal_mb, 'RAM,', payload.ansible_processor_vcpus, 'CPUs')
        var factsAsString = JSON.stringify(payload)

        delete factsAsString.get_version
        delete factsAsString.get_j_version
        delete factsAsString.get_unity_version

        var systeminfoAsString = JSON.stringify(systeminfo)
        var updateStmt = db.prepare('UPDATE vms SET ansible_facts=(?), systeminfo=(?) WHERE host=(?)')

        updateStmt.run(factsAsString, systeminfoAsString, host, function(err) {
            if (err != null) {
                console.log('Error when updating vm:', err)
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

// http POST :3000/vms/reservation contact=TEST requireExternal=false
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
            var requireExternalVm = payload.requireExternal == 'true'
            var findQuery = "SELECT host FROM vms WHERE status = 'free'";
            if (requireExternalVm) {
                console.log('Received request for external VM')
                findQuery += " AND substr(host, -7, 7) = 'systems'"
            } else {
                console.log('Received request for internal VM')
                findQuery += " AND NOT substr(host, -7, 7) = 'systems'"
            }
            findQuery += " ORDER BY host"
            console.log('Executing query', findQuery)
            promDb.getAsync(findQuery).then(function(foundVm) {
                if (foundVm) {
                    console.log('Found VM', foundVm.host)
                    var updateQuery = 'UPDATE vms SET status=(?), contact=(?), bookingtime=(?) , description=(?) WHERE host=(?)'
                    var params = [
                        'in use',
                        payload.contact,
                        new Date().toISOString(),
                        payload.description,
                        foundVm.host
                    ]
                    console.log('Params', params)
                    promDb.runAsync(updateQuery, params).then(function() {
                        console.log('Executed query')
                        res.send(201, {
                            host: foundVm.host,
                            status: 'in use'
                        })
                    }).catch(function (error) {
                        console.log(error)
                        res.send(500, {
                            message: error
                        })
                    })
                } else {
                    var msg = 'All' + (requireExternalVm ? ' external ' : ' internal ') + 'VMs are booked!'
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
