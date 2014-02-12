var nlb = require('../index.js'),
    path = require('path'),
    http = require('http'),
    fs = require('fs'),
    tap = require('tap');



var lib = require('./lib/index'),
    runTest = lib.runTest,
    request = lib.request;


runTest("simple balancer", function(t) {
    request({url: 'http://localhost:8000/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});

runTest("async server fails if readyWhen = started", 
        {file: "server-async.js", readyWhen: 'started'}, function(t) {
    request({url: 'http://localhost:9000/1'}, function(err) {
        t.ok(err, "response should have error: " + err);
        t.end();
    });
});


runTest("async server", {file: "server-async.js"}, function(t) {
    request({url: 'http://localhost:9000/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});

runTest("manual ready signal",
        {file: "server-manual-ready.js", readyWhen: 'ready'}, function(t) {
    request({url: 'http://localhost:9001/1'}, function(err) {
        t.ok(!err, "response should have no error");
        t.end();
    });
});




runTest("broken server", function(t) {
    lib.setServer('server-broken.js', function(err) {
        t.ok(!err, "changing to broken server should work");
        lib.balancer.reload();
        setTimeout(lib.setServer.bind(this, 'server-ok.js', afterOk), 150);
        function afterOk(err) {
            t.ok(!err, "changing to okay server");
            setTimeout(function() {
                request({
                    url: 'http://localhost:8000/1'
                }, function(err) {
                    t.ok(!err, "response should have no error");
                    t.end();
                });
            }, 150);
        }
    });
});

runTest("reload in the middle of a request", function(t) {
    request({url: 'http://localhost:8000/100'}, function(err) {
        t.ok(!err, "Response received");
        t.end();
    });
    setTimeout(lib.balancer.reload.bind(lib.balancer), 10);
});

runTest("old workers dont respond", function(t) {
    lib.setServer('server-unclean.js', function(err) {
        t.ok(!err, "should change to unending server");
        lib.balancer.reload();
        lib.setServer('server-ok.js', function(err) {
            t.ok(!err, "should change to normal server");
            var responses = 0, n = 10;
            function requestComplete(err) {
                t.ok(!err, 'response should be from new worker ' + err);
                if (++responses == n)  {
                    var active =
                        Object.keys(require('cluster').workers).length;
                    t.equals(active, 2, 'only 2 worksers should be active');
                    t.end();
                }
            }
            for (var k = 0; k < n; ++k)
                request({url: 'http://localhost:8000/1'}, requestComplete);
        });
    })
});

runTest("server with an endless setInterval", function(t) {
    lib.setServer('server-unclean.js', function(err) {
        t.ok(!err, "should change to unending server");
        lib.balancer.reload(function() {
            setTimeout(lib.balancer.reload.bind(lib.balancer, function() {
                setTimeout(checkDead, 400); // 400 = timeout + 100ms spawntime
            }), 10);
        });
        function checkDead() {
            t.equal(lib.balancer.workers.length, 2, "only 2 workers should be active");
            t.end(); // this test will never end
        }
    })
});

/**
 * Termination tests
 * 1) dies ungracefully after 1/2 s (lib/server-die-halfsec.js)
 * 2) disconnects  IPC  after 1/2 s (lib/server-disconnect-halfsec.js)
 * 3) msgs 'disconnect' after 1/2 s (lib/server-msg-disconnect-halfsec.js)
 * Then test if
 * 1) they have been replaced quickly
 * 2) they have been killed after a while for (2) and (3)
 *
 * Recommended settings are:
 * respawn: 0.01 - for quick respawns
 * backoff: 0.01 - for quick respawns
 * workers: 2 - to make sure we're not testing only for one
 * timeout: 0.3 - to be able to test if timeout works
 * before the replacement tries to signal that its dead
 *
 * I know that timing-based tests are not perfect, but I have no better
 * idea at the moment.
 */


function extend(opt, add) {
    var res = {};
    for (var key in opt) res[key] = opt[key];
    for (var key in add) res[key] = add[key];
    return res;
}

function pids() {
    return lib.balancer.workers.map(function(w) { return w.process.pid; });
}

var termSettings = {
    respawn: 0.001, backoff: 0.001, workers: 2, timeout: 0.3,
    readyWhen: 'listening'
};

// kill timeout
var timeoutKill = termSettings.timeout * 1000;

// Time after which the worker dies
var timeoutWorker = 500;
// Time to wait for a reload to happen
var timeToSpawn = 200;


termSettings.file = 'server-die-halfsec.js';



runTest("dying server", termSettings, function(t) {
    var wrkpids = pids();
    setTimeout(function() {
        var wrkpids2 = pids();
        t.equal(wrkpids2.length, 2, "2 workers should be active");
        t.notEquals(wrkpids[0], wrkpids2[0], "workers have been replaced");
        t.notEquals(wrkpids[1], wrkpids2[1], "workers have been replaced");
        t.end();
    }, timeoutWorker + timeToSpawn);
});


var discSettings = extend(
    termSettings, {file: 'server-disconnect-halfsec.js'});

runTest("IPC-disconnecting server", discSettings, function(t) {
    var wrkpids = pids();
    setTimeout(function() {
        t.equal(pids().length, 4, "4 workers present, 2 disconnected");
    }, timeoutWorker + timeToSpawn);
    setTimeout(function() {
        t.equal(pids().length, 2, "2 workers present");
        t.end();
    }, timeoutWorker + timeToSpawn + timeoutKill);

});

var dmsgSettings = extend(
    termSettings, {file: 'server-msg-disconnect-halfsec.js'});

runTest("IPC-disconnecting server", dmsgSettings, function(t) {
    var wrkpids = pids();
    setTimeout(function() {
        t.equal(pids().length, 4, "4 workers present, 2 disconnected");
    }, timeoutWorker + timeToSpawn);
    setTimeout(function() {
        t.equal(pids().length, 2, "2 workers present");
        t.end();
    }, timeoutWorker + timeToSpawn + timeoutKill);

});

runTest("stopped cluster", termSettings, function(t) {
    var wrkpids = pids();
    setTimeout(function() {
        lib.balancer.stop();
    }, timeToSpawn);
    setTimeout(function() {
        var wrkpids2 = pids();
        t.equal(wrkpids2.length, 0, "0 workers should be active");
        t.end();
    }, timeoutWorker + timeToSpawn);
});

