var fs = require('fs');

var mongo = require('mongodb');
var MongoClient = mongo.MongoClient;
var Grid = require('gridfs-stream');
var fse = require('fs-extra');
var clone = require('clone');
var moment = require('moment');
var unzip = require('unzip-wrapper');
var archiver = require('archiver');

var DATA_DIR = './data';
var deployments = [];

var mongoDb, deploymentsCollection, gfs;

function uploadDeploymentContent(deployment, callback) {
    // TODO check zip file - create if doesn't exist
    if (deployment.dataUrl) {
        var gridFsFile = deployment.id + '.zip';
        var localZipFile = DATA_DIR + '/' + deployment.id + '/' + gridFsFile;

        function upload() {
            // remove file from GridFS if exists
            gfs.remove({ _id: deployment.id }, function(err) {
                var ws = gfs.createWriteStream({ filename: gridFsFile, _id: deployment.id });
                ws.on('close', function (file) {
                    console.log('Saved content to GridFS: %j', file);
                    //callback();
                });

                fs.createReadStream(localZipFile).pipe(ws);
            });
        }

        if (!fs.existsSync(localZipFile)) {
            var tmpZipFile = DATA_DIR + '/' + gridFsFile;
            var output = fs.createWriteStream(tmpZipFile);
            output.on('close', function() {
                console.log('Generated zip file');
                fse.move(tmpZipFile, localZipFile, function (err) {
                    upload();
                });
            });

            var zip = archiver('zip');
            zip.on('error', function(err) {
                console.log('Error creating zip file: %s', err);
            });

            zip.pipe(output);
            zip.bulk([{ cwd: DATA_DIR + '/' + deployment.id, src: '**', expand: true }]);
            zip.finalize();
        } else {
            upload();
        }

    } else {
        //callback();
    }
}

function downloadDeploymentContent(deployment) {
    var dirName = DATA_DIR + '/' + deployment.id;
    var gridFsFile = deployment.id + '.zip';
    fse.emptyDirSync(dirName);

    gfs.exist({filename: gridFsFile}, function (err, exists) {
       if (exists) {
           fse.emptyDirSync(dirName);
           var zipFile = dirName + '/' + gridFsFile;
           var rs = gfs.createReadStream({filename: gridFsFile});
           var ws = fs.createWriteStream(zipFile);
           ws.on('close', function (err) {
               console.log('Downloaded content from GridFS');
               unzip(zipFile, function (err) {
                   console.log('Unzipped content: %s', err);
               });
           });
           rs.pipe(ws);
       }
    });
}

function removeDeploymentContent(deployment) {
    var gridFsFile = deployment.id + '.zip';
    gfs.remove({filename: gridFsFile}, function(err) {
        console.log('Removed content from GridFS: %s', err);
    });
}

function toDb(deployment) {
    deployment = clone(deployment);
    deployment._id = deployment.id;
    delete deployment.id;
    deployment.created = moment(deployment.created).toDate();
    return deployment;
}

function fromDb(deployment) {
    deployment = clone(deployment);
    deployment.id = deployment._id;
    delete deployment._id;
    deployment.created = moment(deployment.created).format();
    return deployment;
}

module.exports = {
    create: function(deployment) {
        deployments.push(deployment);
        deploymentsCollection.insert([toDb(deployment)], function(err){
            if (err) {
                console.log('Error creating deployment %s', err);
            } else {
                uploadDeploymentContent(deployment);
                console.log('Created deployment %s', deployment.id);
            }
        });
    },

    update: function(deployment, index) {
        // TODO pass 'update content' flag ?
        deploymentsCollection.update({_id: deployment.id}, toDb(deployment), function (err) {
            if (err) {
                console.log('Error updating deployment %s', err);
            } else {
                uploadDeploymentContent(deployment);
                console.log('Updated deployment %s', deployment.id);
            }
        });

        deployments[index] = deployment;
    },

    remove: function(index) {
        var deployment = deployments[index];

        deploymentsCollection.remove({_id: deployment.id}, function (err) {
            if (err) {
                console.log('Error removing deployment %s', err);
            } else {
                removeDeploymentContent(deployment);
                console.log('Removed deployment %s', deployment.id);
            }
        });

        deployments.splice(index, 1);
    },

    load: function(mongoDbUrl, callback) {
        fse.emptyDirSync(DATA_DIR);
        MongoClient.connect('mongodb://' + mongoDbUrl, function(err, db) {
            if (err) {
                throw new Error('Could not connect to MongoDB ' + mongoDbUrl + ': ' + err.message);
            } else {
                mongoDb = db;
                deploymentsCollection = db.collection('deployments');

                deploymentsCollection.find({}).sort(['created']).toArray(function(err, docs) {
                    if (err) {
                        throw new Error('Could not read deployments data: ' + err.message);
                    }

                    gfs = Grid(db, mongo);

                    deployments = [];
                    docs.forEach(function (doc) {
                        var deployment = fromDb(doc);
                        deployments.push(deployment);
                        downloadDeploymentContent(deployment);
                    });

                    console.log('Connected to MongoDB at %s. Loaded %d deployments', mongoDbUrl, deployments.length);
                    callback(deployments);
                });
            }
        });
    }
};