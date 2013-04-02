var nlb = require('../index.js');

var cluster = nlb(__dirname + '/server.js');

cluster.run();
