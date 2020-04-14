var app = angular.module('vm-reservation', ['ngRoute', 'ngResource', 'ngCookies', 'ui.bootstrap'])

app.constant('config', {
    // endpoint: 'http://localhost:3000/'
    endpoint: 'http://teamred-jenkins.vm-intern.epages.com:3000/'
})

app.config(function($routeProvider) {
    $routeProvider.when('/', {
        templateUrl: 'vms.htm',
        controller: 'vmListController'
    })
})

function prepareBookingDate(vm) {
    if ('free' == vm.status) {
        vm.inUseForDays = ''
    } else {
        vm.inUseForDays = moment(vm.bookingtime).fromNow()
    }
}

app.controller('vmListController', function(config, $scope, $http, $modal) {
    $http.get(config.endpoint + 'vms').then(function(result) {
        vms = result.data
        for (var i = 0; i < vms.length; i++) {
            prepareBookingDate(vms[i])
        }

        $scope.vms = vms

        $scope.edit = function(vm) {
            var modalInstance = $modal.open({
                animation: true,
                templateUrl: 'edit.htm',
                controller: 'editVMController',
                resolve: {
                    selectedVm: function() {
                        return vm
                    }
                }
            })

            modalInstance.result.then(function(editedVm) {
                var vmToUpdate = $scope.vms.filter(function (vm) {
                    return vm.host === editedVm.host
                })[0]
                if (vmToUpdate.status !== 'free' && editedVm.status === 'free') {
                    $http.delete(config.endpoint + 'vms/' + vm.host + '/reservation').success(function() {
                        console.log('Freeing VM', vm)
                    })
                } else {
                    var currentDate = new Date()
                    editedVm.bookingtime = currentDate.toISOString()
                    prepareBookingDate(editedVm)
                    Object.assign(vmToUpdate, editedVm)
                    $http.put(config.endpoint + 'vms/' + vm.host, vm).success(function() {
                        console.log('Updated VM info', vm)
                    })
                }
                var currentDate = new Date()
                editedVm.bookingtime = currentDate.toISOString()
                prepareBookingDate(editedVm)
                Object.assign(vmToUpdate, editedVm)
            })
        }
    })
})

app.controller('editVMController', function($scope, $modalInstance, selectedVm, $cookies) {

    $scope.vm = angular.copy(selectedVm)
    $scope.vm.contact = selectedVm.contact || $cookies.get('defaultContact')

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
