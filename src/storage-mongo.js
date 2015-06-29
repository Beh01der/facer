var fs = require('fs');

var mongo = require('mongodb');
var MongoClient = mongo.MongoClient;
var Grid = require('gridfs-stream');
var fse = require('fs-extra');
var clone = require('clone');
var moment = require('moment');
var unzip = require('unzip-wrapper');
var archiver = require('archiver');
var commander = require('commander');

var DATA_DIR = './data';
var deployments = [];

var mongoDb, deploymentsCollection, gfs;

function uploadDeploymentContent(deployment) {
    if (deployment.dataUrl) {
        var gridFsFile = deployment.id + '.zip';
        var localZipFile = DATA_DIR + '/' + deployment.id + '/' + gridFsFile;

        function upload() {
            // remove file from GridFS if exists
            gfs.remove({ filename: gridFsFile }, function(err) {
                var ws = gfs.createWriteStream({ filename: gridFsFile, _id: deployment.id });
                ws.on('error', function (err) {
                    console.log('Error uploading file "%s" content from GridFS: %j', gridFsFile, err);
                });

                fs.createReadStream(localZipFile).pipe(ws);
            });
        }

        if (!fs.existsSync(localZipFile)) {
            var tmpZipFile = DATA_DIR + '/' + gridFsFile;
            var output = fs.createWriteStream(tmpZipFile);
            output.on('close', function() {
                fse.move(tmpZipFile, localZipFile, function (err) {
                    if (err) {
                        console.log('Error moving file "%s": %j', gridFsFile, err);
                    } else {
                        upload();
                    }
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

    }
}

function downloadDeploymentContent(deployment) {
    var dirName = DATA_DIR + '/' + deployment.id;
    var gridFsFile = deployment.id + '.zip';
    fse.emptyDirSync(dirName);

    gfs.exist({ filename: gridFsFile }, function (err, exists) {
        if (err) {
            console.log('Error GridFS file "%s" exist check: %j', gridFsFile, err);
        } else {
            if (exists) {
                fse.emptyDirSync(dirName);
                var zipFile = dirName + '/' + gridFsFile;
                var rs = gfs.createReadStream({ filename: gridFsFile });
                var ws = fs.createWriteStream(zipFile);
                ws.on('close', function () {
                    unzip(zipFile, function (err) {
                        if (err) {
                            console.log('Error unzipping file "%s": %j', gridFsFile, err);
                        }
                    });
                }).on('error', function (err) {
                    console.log('Error downloading file "%s" content from GridFS: %j', gridFsFile, err);
                });
               rs.pipe(ws);
            }
        }
    });
}

function removeDeploymentContent(deployment) {
    var gridFsFile = deployment.id + '.zip';
    gfs.remove({filename: gridFsFile}, function(err) {
        if (err) {
            console.log('Error removing file "%s" from GridFS: %j', gridFsFile, err);
        }
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
                console.log('Error creating deployment in MongoDB "%s": %j', deployment.id, err);
            } else {
                uploadDeploymentContent(deployment);
            }
        });
    },

    update: function(deployment, index, updateContent) {
        deploymentsCollection.update({ _id: deployment.id }, toDb(deployment), function (err) {
            if (err) {
                console.log('Error updating deployment %s', err);
            } else {
                if (updateContent) {
                    uploadDeploymentContent(deployment);
                }
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
            }
        });

        deployments.splice(index, 1);
    },

    load: function(callback) {
        fse.emptyDirSync(DATA_DIR);
        MongoClient.connect('mongodb://' + commander.mongoUrl, function(err, db) {
            if (err) {
                throw new Error('Could not connect to MongoDB ' + commander.mongoUrl + ': ' + err.message);
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

                    console.log('Connected to MongoDB at %s. Loaded %d deployments', commander.mongoUrl, deployments.length);
                    callback(deployments);
                });
            }
        });
    }
};