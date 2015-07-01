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
    rules: [
         {
             age: '8 hours'
         },
        {
             age: '1 year',
             match: {
                path: '[.](js|css|gif|jpe?g|png|woff|ico|eot|svg|ttf)$'
             },
             rewrite: {
                path: '.*',
                newPath: '/cloud$0'
             }
        },
        {
            match: {
                path: '^/cloud/api'
            },
            proxy: {
                downstream: 'http://localhost:3000'
            }
        }
    ]
}

patch fields:
* state
* contentModified
* dataUrl
* rules

 */

var fse = require('fs-extra');
var commander = require('commander');
var pack = fse.readJsonSync('package.json');

commander
    .version(pack.version)
    .option('-t, --token <value>', 'secure token')
    .option('-p, --port <n>', 'service port', 3000, parseInt)
    .option('-m, --mongo-url <value>', 'MongoDB connection url "host:[port]/db"') // localhost:27017/setic
    .option('-v, --verbose', 'verbose output')
    .parse(process.argv);

if (!commander.token) {
    console.log('Warning!!! Security is disabled for this service! It allows public access to all service functionality!');
    console.log('To enable security, pass secure token as a parameter (must be at least 32 char long).');
    console.log('Example: node src/service.js -t D9LEwTq1hkZOQhEdiH3LGLZ1vELO283H');
}

var express = require('express');
var moment = require('moment');
var bodyParser = require('body-parser');
var validator = require('node-validator');
var clone = require('clone');
var morgan = require('morgan');

var deploymentManager = require('./deployments');
var serveStatic = require('./serve-static');
var serveDownstream = require('./serve-downstream');

var fileDir = './data';

fse.ensureDirSync(fileDir);

var app = express();

// middlewares
function noCache(req, res, next) {
    res.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
}

function authorise(req, res, next) {
    // authorisation check
    if (commander.token) {
        var token = req.header('X-Auth-Token') || req.query.token;
        if (commander.token !== token) {
            // authentication failed
            return res.status(401)
                .json({
                    code: 'ERROR',
                    time: moment().format(),
                    message: 'Access Denied'
                });
        }
    }

    next();
}

function returnDeploymentInfo(req, res) {
    var deployment = clone(req.deployment);

    res.json({
        code: 'OK',
        time: moment().format(),
        deployment: deployment
    });
}

function returnDeploymentList(req, res) {
    res.json({
        code: 'OK',
        time: moment().format(),
        deployments: deploymentManager.list
    });
}

function patchDeployment(req, res, next) {
    var fields = req.body;
    var deployment = req.deployment;
    req.dontUpdateContent = true;

    if (fields.name) {
        deployment.name = fields.name;
    }

    if (fields.state) {
        deployment.state = fields.state;
    }

    if (fields.rules) {
        deployment.rules = fields.rules;
    }

    if (fields.contentModified) {
        deployment.contentModified = fields.contentModified;
    }

    if (fields.dataUrl) {
        req.dontUpdateContent = false;
        deployment.dataUrl = fields.dataUrl;
    }

    req.body = deployment;
    next();
}

function createOrUpdateDeployment(req, res, next) {
    deploymentManager.createOrUpdateDeployment(req.body, req.deployment, req.dontUpdateContent, function (err, newDeployment){
        if (!err) {
            req.deployment = newDeployment;
        } else {
            delete req.deployment;
        }

        next(err);
    });
}

function findDeployment(req, res, next) {
    // * search by id
    // * search by index from top: 1..n
    // * search by index from bottom: -1..-n
    // * search by name
    var id = req.params.id;
    var deployment;
    if (id) {
        if (id.length === 32) {
             //looks like id
            deployment = deploymentManager.getDeploymentById(id);
        }

        if (!deployment) {
            var index = parseInt(id);
            if (index) {
                // looks like index
                deployment = deploymentManager.getDeploymentByIndex(index);
            }
        }

        if (!deployment) {
            deployment = deploymentManager.getDeploymentByName(id);
        }
    }

    if (deployment) {
        req.deployment = deployment;
        next();
    } else {
        res.status(404)
            .json({
                code: 'ERROR',
                time: moment().format(),
                message: 'Deployment not found'
        });
    }
}

function deleteDeployment(req, res, next) {
    deploymentManager.removeDeployment(req.deployment);
    next();
}

var matchSectionRestModel = validator
    .isObject()
    .withRequired('path', validator.isString());

var proxySectionRestModel = validator
    .isObject()
    .withRequired('downstream', validator.isString());

var rewriteSectionRestModel = validator
    .isObject()
    .withOptional('path', validator.isString())
    .withOptional('newPath', validator.isString());

var ruleRestModel = validator
    .isObject()
    .withOptional('match', matchSectionRestModel)
    .withOptional('proxy', proxySectionRestModel)
    .withOptional('rewrite', rewriteSectionRestModel)
    .withOptional('age', validator.isString());

var deploymentRestModel = validator
    .isObject()
    .withRequired('name', validator.isString())
    .withRequired('state', validator.isString({ regex: /^(active|inactive)$/ }))
    .withRequired('rules', validator.isArray(ruleRestModel, { min: 1, max: 30 }))
    .withOptional('dataUrl', validator.isString())
    .withOptional('contentModified', validator.isIsoDateTime());

var patchDeploymentRestModel = validator
    .isObject()
    .withOptional('name', validator.isString())
    .withOptional('state', validator.isString({ regex: /^(active|inactive)$/ }))
    .withOptional('dataUrl', validator.isString())
    .withOptional('rules', validator.isArray(ruleRestModel, { min: 1, max: 30 }))
    .withOptional('contentModified', validator.isIsoDateTime());

// set up logging
morgan.token('error', function (req) {
    var errorInfo = req.errorInfo;
    if (errorInfo) {
        errorInfo = errorInfo.replace(/\s+/g, ' ');
    }

    return errorInfo || '';
});

if (commander.verbose) {
    morgan.token('rule', function (req) {
        var rule = req.rule;
        return rule ? rule.name + ':' + rule.type[0] : '';
    });

    app.use(morgan(':date[iso] [:rule] :method :url :status :res[content-length] - :response-time ms | :error'));
} else {
    var isControlApi = /^\/control\/deployment/;
    app.use(
        morgan(':date[iso] :method :url :status :res[content-length] - :response-time ms | :error',
        { skip: function (req, res) { return !isControlApi.test(req.url) && res.statusCode < 400; } })
    );
}

app.all('/control/deployment*', noCache, authorise);

app.get('/control/deployments', returnDeploymentList);

app.post('/control/deployments', bodyParser.json(), validator.bodyValidator(deploymentRestModel), createOrUpdateDeployment, returnDeploymentInfo);

app.get('/control/deployments/:id', findDeployment, returnDeploymentInfo);

app.put('/control/deployments/:id', findDeployment, bodyParser.json(), validator.bodyValidator(deploymentRestModel), createOrUpdateDeployment, returnDeploymentInfo);

app.patch('/control/deployments/:id', findDeployment, bodyParser.json(), validator.bodyValidator(patchDeploymentRestModel), patchDeployment, createOrUpdateDeployment, returnDeploymentInfo);

app.delete('/control/deployments/:id', findDeployment, deleteDeployment, returnDeploymentInfo);

app.all('*', deploymentManager.findRule, serveStatic, serveDownstream);

// handle all unexpected errors
app.disable('x-powered-by');

app.use(function(err, req, res, next) {
    if (err) {
        var errorInfo = '';
        if (err.message) {
            errorInfo += err.message;
        }

        if (err.body) {
            errorInfo += ': ' + err.body;
        }

        req.errorInfo = errorInfo;

        res.status(400).json({
            code: 'ERROR',
            time: moment().format(),
            message: 'Invalid request'
        });
    }
});

app.listen(commander.port, function () {
    console.log('setic ' + pack.version + ' listening on port ' + commander.port);
});
