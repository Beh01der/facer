var request = require('request-json');

var baseUrl = 'http://localhost:3000';
var apiAccessToken = 'ZmM2NzMzMWZiMTkxYjhhNmRkMjQzMzBlMzM0ZWE3NzM5NzU1NmRlYjc4YzM5OGRmYjQ5Yzk';//'put your token here';

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

createDeployment({
    "name": "memz-client-15-0528-0928",
    "state": "active",
    "contentModified": "2015-01-01T00:00:00+10:00",
    "dataUrl": "http://localhost:3001/WGCz8wbTIoQNsNcNUauZN4lcS1UUR2Xf/files/0",
    "modules": [
        {
            "type": "static",
            //"age": "0",
            "age": "1 year",
            "match": {
                "url": "(js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$"
            }
        },
        {
            "type": "static",
            //"age": "0",
            "age": "8 hours",
            "match": {
                "url": ".*"
            }
        }
    ]
}, function() {
    createDeployment({
        "name": "memz-client-15-0623-1905",
        "state": "active",
        "dataUrl": "http://localhost:3001/VAbOYNsYRKzWCWqDUNkzjj0t1cIivSRN/files/0",
        "modules": [
            {
                "type": "static",
                //"age": "0",
                "age": "1 year",
                "match": {
                    "url": "(js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$"
                }
            },
            {
                "type": "static",
                //"age": "0",
                "age": "8 hours",
                "match": {
                    "url": ".*"
                }
            }
        ]
    });
});
