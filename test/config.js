'use strict';

var tap = require('tap');
var recluster = require('..');
var cluster = require('cluster');
var workerPath = require('path').join.bind(null, __dirname, 'workers');

tap.test('config is correctly parsed', function(t) {
    recluster.configure({
        exec: workerPath(),
        args: ['--some=arg', '--more=arg'],
        silent: true
    });
    t.ok(
        cluster.settings.silent,
        'configure should proxy the config to cluster'
    );
    t.equal(
        cluster.settings.exec,
        workerPath(),
        'exec should be here'
    );
    t.deepEqual(cluster.settings.args, ['--some=arg', '--more=arg']);
    t.end();
});

tap.test('config missing exec', function(t) {
    t.throws(function() {
        recluster.configure({
            args: ['--some=arg', '--more=arg']
        });
    }, {message: 'exec option missing'}, 'We need to send an exec to the configure method');

    t.end();
});
