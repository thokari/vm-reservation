var app = angular.module('vm-reservation', ['ngRoute', 'ngResource', 'ngCookies', 'ui.bootstrap'])

app.constant('config', {
    endpoint: 'http://localhost:3000/'
    // endpoint: 'http://teamred-jenkins.vm-intern.epages.com:3000/'
})

app.config(function($routeProvider) {
    $routeProvider.when('/', {
        templateUrl: 'vms.htm',
        controller: 'vmListController'
    })
})

function getBookingAgeInDays(bookingDateInMs) {
    var oneDayInMillisecounds = (24 * 60 * 60 * 1000)
    var currentDate = new Date()
    if (currentDate.getTime() <= bookingDateInMs) {
        return 0
    }
    var inUseForDays = Math.round(Math.abs((currentDate.getTime() - bookingDateInMs) / oneDayInMillisecounds))
    return inUseForDays
}

function prepareBookingDate(vm) {
    if ('free' == vm.status) {
        vm.bookingDate = ''
        vm.inUseForDays = ''
    } else {
        vm.bookingDate = Date.parse(vm.bookingtime)
        vm.inUseForDays = getBookingAgeInDays(vm.bookingDate)
    }
}

app.controller('vmListController', function(config, $scope, $http, $modal) {
    $http.get(config.endpoint + 'vms').then(function(result) {
        vms = result.data.vms
        for (var i = 0; i < vms.length; i++) {
            prepareBookingDate(vms[i])
        }

        $scope.vms = vms

        $scope.edit = function(id) {
            var vm = vms[id]
            var modalInstance = $modal.open({
                animation: true,
                templateUrl: 'edit.htm',
                controller: 'editVMController',
                resolve: {
                    selectedVM: function() {
                        return vm
                    }
                }
            })

            modalInstance.result.then(function(vm) {
                var currentDate = new Date()
                vm.bookingtime = currentDate.toString()
                prepareBookingDate(vm)
                var vmToUpdate = $scope.vms[id]
                vmToUpdate.host = vm.host
                vmToUpdate.status = vm.status
                vmToUpdate.description = vm.description
                vmToUpdate.contact = vm.contact
                vmToUpdate.systeminfo = vm.systeminfo
                vmToUpdate.bookingDate = vm.bookingDate
                vmToUpdate.bookingtime = vm.bookingtime
                vmToUpdate.inUseForDays = vm.inUseForDays
                vmToUpdate.ansible_facts = vm.ansible_facts
                $http.put(config.endpoint + 'vms/' + id, vm).success(function() {
                    console.log('Updated VM info', vm)
                })
            })
        }
    })
})

app.controller('editVMController', function($scope, $modalInstance, selectedVM, $cookies) {

    $scope.vm = {
        id: selectedVM.id,
        host: selectedVM.host,
        status: selectedVM.status,
        description: selectedVM.description,
        contact: selectedVM.contact || $cookies.get('defaultContact'),
        systeminfo: selectedVM.systeminfo,
        ansible_facts: selectedVM.ansible_facts
    }

    $scope.changeStatus = function() {
        if ($scope.vm.status == 'free') {
            $scope.vm.description = ''
            $scope.vm.contact = ''
            $modalInstance.close($scope.vm)
        }
    }

    $scope.save = function() {
        $cookies.put('defaultContact', $scope.vm.contact)
        $modalInstance.close($scope.vm)
    }

    $scope.close = function() {
        $modalInstance.dismiss('cancel')
    }
})
