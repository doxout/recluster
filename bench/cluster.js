var recluster = require('..');
var path = require('path');

recluster.configure({
    exec: path.resolve(__dirname, '/server.js')
});

recluster.run();
