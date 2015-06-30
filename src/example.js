var request = require('request-json');

var baseUrl = 'http://localhost:3000';
var apiAccessToken = 'ZmM2NzMzMWZiMTkxYjhhNmRkMjQzMzBlMzM0ZWE3NzM5NzU1NmRlYjc4YzM5OGRmYjQ5Yzk';//'put your token here';

function deleteDeployment(id, callback) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.del('/control/deployments/' + id, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }

        if (callback) {
            callback();
        }
    });
}

function createDeployment(deployment, callback) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.post('/control/deployments', deployment, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }

        if (callback) {
            callback();
        }
    });
}

function updateDeployment(deployment, callback) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.put('/control/deployments/' + deployment.name, deployment, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }

        if (callback) {
            callback();
        }
    });
}

function patchDeployment(id, patch, callback) {
    var client = request.createClient(baseUrl);
    client.headers['X-Auth-Token'] = apiAccessToken;

    client.patch('/control/deployments/' + id, patch, function(err, res, body) {
        if (err) {
            console.error(err);
        } else {
            console.log('%d : %j', res.statusCode, body);
        }

        if (callback) {
            callback();
        }
    });
}

//deleteDeployment('syfZsICCudSUS8eebhA4mH1Jug4MwRdq');
//patchDeployment('IF2wdrNKtWEEN1hYVoKRQcaHiDMNFlhB', { state: 'active' });


createDeployment({
    "name": "memz-client-15-0528-0928",
    "state": "active",
    "contentModified": "2015-01-01T00:00:00+10:00",
    "dataUrl": "/Users/andrey/Tmp/deployment-15-0528-0928.zip",
    //"dataUrl": "/Users/andrey/Work/Projects/Memability/Memability4all/build/deploy/public",
    //"dataUrl": "http://localhost:3001/FgOmPuNV22cWkRDVvRlUYA3DFvSz84vc/files/0",
    "rules": [
        {
            "age": "8 hours"
        },
        {
            "age": "1 year",
            "match": {
                "path": "[.](js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$"
            }
        },
        {
            "proxy": {
                "downstream": "http://localhost:3002"
            },
            "rewrite": {
                "path": "^/cloud(.*)",
                "newPath": "$1"
            }
        }
    ]
}, function() {
    //createDeployment({
    //    "name": "memz-client-15-0623-1905",
    //    "state": "active",
    //    "dataUrl": "http://localhost:3001/Zx9mSexy4s7CTmVLR7xmGUhxyu0LAbks/files/0",
    //    "rules": [
    //        {
    //            //"age": "0",
    //            "age": "8 hours"
    //        },
    //        {
    //            //"age": "0",
    //            "age": "1 year",
    //            "match": {
    //                "path": "[.](js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$"
    //            }
    //        }
    //    ]
    //});
});

