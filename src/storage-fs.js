var fse = require('fs-extra');

var DEPLOYMENTS_FILE = './data/deployments.json';
var deployments = [];

function save() {
    try {
        fse.writeJsonSync(DEPLOYMENTS_FILE, deployments);
    } catch(e) {
        console.log('Error: could not write deployments file: %j', e);
    }
}

module.exports = {
    create: function(deployment) {
        deployments.push(deployment);
        save();
    },

    update: function(deployment, index, updateContent) {
        deployments[index] = deployment;
        save();
    },

    remove: function(index) {
        deployments.splice(index, 1);
        save();
    },

    load: function(callback) {
        try {
            deployments = fse.readJsonSync(DEPLOYMENTS_FILE) || [];
        } catch (e) {
            console.log('Error: could not read deployments file: %j', e);
            deployments = [];
        }

        console.log('Using FS data storage. Loaded %d deployments', deployments.length);

        callback(deployments);
    }
};