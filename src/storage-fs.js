var fse = require('fs-extra');

var DEPLOYMENTS_FILE = './data/deployments.json';
var deployments = [];

function save() {
    fse.writeJsonSync(DEPLOYMENTS_FILE, deployments);
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

    load: function(notUsed, callback) {
        try {
            deployments = fse.readJsonSync(DEPLOYMENTS_FILE) || [];
        } catch (e) {
            deployments = [];
        }

        console.log('Using FS data storage. Loaded %d deployments', deployments.length);

        callback(deployments);
    }
};