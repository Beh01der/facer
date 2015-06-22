/*

GET control/deployments -> list of current deployments
POST control/deployments -> new deployment
GET control/deployments/:id -> deployment info
PATCH control/deployments/:id -> partially update deployment
DELETE control/deployments/:id -> delete deployment

deployment object:
{
    id: string,
    name: string,
    state: active|inactive,
    created: time,
    updated: time,
    contentModified: time,
    dataUrl: string (url to get zipped content)
    dataSize: number,
    modules: [
        {
             type: static,
             age: '1 year',
             match: {
                url: '/\.(js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$/i'
             }
        },
        {
            type: static,
            age: '8 hours',
            match: {
                url: '.*'
            }
        }
    ]
}


 header: [
 'Cache-Control': 'public, max-age=12223, s-maxage=12223',
 'Pragma': 'public'
 ]

 */

var deployments = [];

var fs = require('fs');

var express = require('express');
var rimraf = require('rimraf');
var moment = require('moment');
var bodyParser = require('body-parser');
var validator = require('node-validator');

var fileDir = './data';
function log(message) {
    console.log('%s INFO %s', moment(Date.now()).format(), message);
}

function error(message) {
    console.log('%s ERROR %s', moment(Date.now()).format(), message);
}

rimraf.sync(fileDir);
fs.mkdirSync(fileDir);

if (process.argv.length < 3 || (process.argv[2].length < 32 && process.argv[2] !== '--disable-security')) {
    error('Usage: node src/service.js [secure-token-at-least-32-chars]|--disable-security');
    process.exit(1);
}

var secureToken = process.argv[2];
if (secureToken === '--disable-security') {
    secureToken = undefined;
    log('Warning!!! Security is disabled for this service! It allows public access to all service funcitonality!');
    log('To enable security, pass secure token as a parameter (must be at least 32 char long).');
    log('Example: node src/service.js D9LEwTq1hkZOQhEdiH3LGLZ1vELO283H');
}

var app = express();

// middlewares
function noCache(req, res, next) {
    res.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
}

function authorise(req, res, next) {
    // authorisation check
    if (secureToken) {
        var token = req.header('X-Auth-Token') || req.query.token;
        if (secureToken !== token) {
            // authentication failed
            return res.status(401).json({
                code: 'ERROR',
                message: 'Access Denied'
            });
        }
    }

    next();
}

function returnDeploymentInfo(req, res) {
    res.json({
        code: 'OK',
        time: Date.now()
    });
}

function returnDeploymentList(req, res) {
    res.json(deployments);
}

function createDeployment(req, res) {
    res.json({
        code: 'OK',
        time: Date.now()
    });
}

function findDeployment(req, res) {
    res.json({
        code: 'OK',
        time: Date.now()
    });
}

function deleteDeployment(req, res) {
    res.json({
        code: 'OK',
        time: Date.now()
    });
}

var matchRulesModel = validator
    .isObject()
    .withRequired('url', validator.isString());

var moduleRestModel = validator
    .isObject()
    .withRequired('type', validator.isString({ regex: /static/ }))
    .withRequired('age', validator.isString())
    .withRequired('match', matchRulesModel)
    .withOptional('rewrite', validator.isObject());

var deploymentRestModel = validator
    .isObject()
    .withRequired('name', validator.isString())
    .withRequired('state', validator.isString({ regex: /active|inactive/ }))
    .withRequired('dataUrl', validator.isString())
    .withRequired('modules', validator.isArray(moduleRestModel, { min: 1, max: 10 }))
    .withOptional('contentModified', validator.isIsoDateTime());

app.all('/control/deployment*', noCache, authorise);

app.get('/control/deployments', returnDeploymentList);

app.post('/control/deployments', bodyParser.json(), validator.express(deploymentRestModel), createDeployment, returnDeploymentInfo);

app.get('/control/deployments/:id', findDeployment, returnDeploymentInfo);

app.patch('/control/deployments/:id', findDeployment, bodyParser.json(), returnDeploymentInfo);

app.delete('/control/deployments/:id', findDeployment, deleteDeployment, returnDeploymentInfo);

// handle all unexpected errors
app.use(function(error, req, res, next) {
    if (error) {
        error('Internal server error: ' + error.message);

        res.status(400).json({
            code: 'ERROR',
            message: 'Invalid request'
        });
    }
});

app.listen(3000, function () {
    log('Listening on port 3000');
});
