var nlb = require('../index.js'),
    path = require('path'),
    http = require('http'),
    fs = require('fs'),
    tap = require('tap');



var lib = require('./lib/index'),
    runTest = lib.runTest,
    request = lib.request;

/**
 * maxlistener bug
 */


runTest('maxlisteners warning', function(t) {
    function reloadMany(n, cb) {
        lib.balancer.reload(function() {
            if (n > 0) return reloadMany(--n, cb);
            cb();
        });
    }
    reloadMany(30, function() {
        t.ok(true, 'reloaded 30 times');
        t.end();
    });
});


