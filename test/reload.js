'use strict';

var tap = require('tap');
var recluster = require('..');
var cluster = require('cluster');
var workerPath = require('path').join.bind(null, __dirname, 'workers');
var request = require('supertest');

request = request('http://localhost:9000');

tap.test('reload', function(t) {
    recluster.configure({
        exec: workerPath('server.js'),
        workers: 2
    });

    recluster.run();

    recluster.once('listening', function() {
        t.equal(2, Object.keys(cluster.workers).length, 'there are 2 workers');
        t.equal(1, (function() {
            var id;
            var j = 0;
            for (id in cluster.workers) {
                if (cluster.workers[id].state === 'listening') {
                    ++j;
                }
            }
            return j;
        }()), 'there is only 1 listening');

        request.get('/')
            .end(function(err, res) {
                var i;
                if (err) {
                    throw new Error(err);
                }
                t.equal(res.text, 'hello world\n');

                i = 0;
                recluster.on('respawn', function onRespawn() {
                    ++i;
                    if (i !== 2) {
                        return;
                    }

                    t.equal(2, (function() {
                        var id;
                        var j = 0;
                        for (id in cluster.workers) {
                            if (!cluster.workers[id].suicide && cluster.workers[id].state !== 'listening') {
                                ++j;
                            }
                        }
                        return j;
                    }()), 'there are 2 workers initializing');

                    recluster.removeListener('respawn', onRespawn);

                    setTimeout(function() {
                        t.equal(2, Object.keys(cluster.workers).length, 'There should be only 2 workers');
                        t.equal(2, (function() {
                            var id;
                            var j = 0;
                            for (id in cluster.workers) {
                                if (cluster.workers[id].state === 'listening') {
                                    ++j;
                                }
                            }
                            return j;
                        }()), 'Both in listening state');
                    }, 2500);

                    setTimeout(function() {
                        recluster.stop();
                    }, 5000);

                    recluster.once('stopped', function() {
                        t.equal(0, Object.keys(cluster.workers).length, 'There are no more workers once stopped event');
                        t.end();
                    });
                });

                recluster.reload();
            });

        // when reloading, there should be no downtime
        recluster.on('no-listening', function() {
            if (!recluster.isStopping) {
                throw new Error('We have downtime');
            }
        });
    });
});
