var lib = require('./lib/index'),
    runTest = lib.runTest,
    request = lib.request;

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
var timeToSpawn = 100;
// Time necessary to terminate a worker
var timeToKill = 20;

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
    }, timeoutWorker + timeToSpawn + timeoutKill + timeToKill);

});

var dmsgSettings = extend(
    termSettings, {file: 'server-msg-disconnect-halfsec.js'});

runTest("IPC-disconnecting server via msg", dmsgSettings, function(t) {
    var wrkpids = pids();
    setTimeout(function() {
        t.equal(pids().length, 4, "4 workers present, 2 disconnected");
    }, timeoutWorker + timeToSpawn);
    setTimeout(function() {
        t.equal(pids().length, 2, "2 workers present");
        t.end();
    }, timeoutWorker + timeToSpawn + timeoutKill + timeToKill);

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

