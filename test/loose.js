'use strict';

var tap = require('tap');
var recluster = require('..');
var workerPath = require('path').join.bind(null, __dirname, 'workers');

tap.test('loose false', function(t) {
    recluster.configure({
        exec: workerPath('server.js'),
        workers: 1
    });

    t.equal(recluster.nbWorkers, 1);

    recluster.run();

    t.throws(function() {
        recluster.run();
    }, {
        message: 'You can not run when it is already running'
    }, 'We can not run 2 times');

    recluster.stop();

    recluster.once('stopped', function() {
        t.end();
    });
});

tap.test('loose true', function(t) {
    recluster.configure({
        exec: workerPath('server.js'),
        workers: 1,
        loose: true
    });

    t.equal(recluster.nbWorkers, 1);

    recluster.run();

    recluster.run();

    recluster.stop();

    recluster.once('stopped', function() {
        t.end();
    });
});
