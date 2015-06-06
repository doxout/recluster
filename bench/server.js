'use strict';

var http = require('http');
var debug = require('debug')('rc:bench');
var port = 8000;

http.createServer(function(req, res) {
    res.writeHead(200);
    res.end('hello world\n');
}).listen(port, function() {
    debug('Running on port ' + port);
});
