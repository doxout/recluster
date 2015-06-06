'use strict';

var tap = require('tap');
var recluster = require('..');
var cluster = require('cluster');
var workerPath = require('path').join.bind(null, __dirname, 'workers');

tap.test('respawn', function(t) {
    recluster.configure({
        exec: workerPath('server.js'),
        workers: 2
    });

    recluster.run();

    recluster.once('listening', function() {
        var i = 0;
        var id;

        t.equal(2, Object.keys(cluster.workers).length, 'There are 2 workers');

        recluster.on('respawn', function onRespawn() {
            ++i;
            if (i !== 2) {
                return;
            }
            recluster.removeListener('respawn', onRespawn);
            recluster.stop();

            recluster.once('stopped', function() {
                t.equal(0, Object.keys(cluster.workers).length, 'There are no more workers once stopped event');
                t.end();
            });
        });

        // just send a kill signal
        for (id in cluster.workers) {
            if ({}.hasOwnProperty.call(cluster.workers, id)) {
                cluster.workers[id].process.kill('SIGKILL');
            }
        }
    });

    // when respawing, as in unexpected respawn, there can be downtime
    recluster.on('no-listening', function() {
        // what to do here, sometimes there is downtime, sometimes there isn't ...
    });
});
