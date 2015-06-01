'use strict';

var tap = require('tap');
var recluster = require('..');
var cluster = require('cluster');
var workerPath = require('path').join.bind(null, __dirname, 'workers');
var request = require('supertest');

request = request('http://localhost:9000');

tap.test(function(t) {
    recluster.configure({
        exec: workerPath('server.js'),
        workers: 2
    });

    recluster.run();

    recluster.once('listening', function() {
        request.get('/')
            .end(function(err, res) {
                if (err) {
                    throw new Error(err);
                }
                t.equal(res.text, 'hello world\n');
                recluster.stop();
                recluster.once('stopped', function() {
                    t.equal(0, Object.keys(cluster.workers).length, 'There are no more workers once stopped event');
                    t.end();
                });
            });
    });
});
