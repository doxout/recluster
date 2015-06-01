'use strict';

var pkg = require('./package');
var assert = require('assert');
var cluster = require('cluster');
var debug = require('debug')('rc');
var numCPUs = require('os').cpus().length;
var EventEmitter = require('events').EventEmitter;
var util = require('util');
var singleton;

assert(cluster.isMaster, 'You cannot use ' + pkg.name + ' in a worker');

function Recluster() {
    this.isStopping = false;
    this.isListening = false;
    this.isRunning = false;
    this.loose = false;

    this.nbWorkers = numCPUs;
}
util.inherits(Recluster, EventEmitter);

// Create and export a singleton
singleton = new Recluster();

module.exports = singleton;

// @todo: reintroduce previous functionality
Recluster.prototype.configure = function configure(opts) {
    // If you enable loose mode and something craps in your hands, I do not care
    this.loose = !!opts.loose || false;

    assert(this.loose || !this.isRunning && !this.isStopping, 'The cluster should neither be running or stopping');

    assert(opts && opts.exec, 'exec option missing');

    cluster.setupMaster(opts);
    this.nbWorkers = opts.workers || numCPUs;
};

function nbOfWorkersListening() {
    var id;
    var nbListenings = 0;
    for (id in cluster.workers) {
        if (cluster.workers[id].state === 'listening') {
            ++nbListenings;
        }
    }
    return nbListenings;
}

// @todo: do something so that fully-listening can get triggered when we reload ?
// or maybe not :o
function onListening(worker) {
    debug('listening: ' + worker.process.pid);

    if (!singleton.isListening) {
        singleton.isListening = true;
        singleton.emit('listening', worker);
    }

    if (nbOfWorkersListening() === singleton.nbWorkers) {
        singleton.emit('fully-listening');
    }
}

function onDisconnect(worker) {
    debug('disconnect: ' + worker.process.pid);

    if (!nbOfWorkersListening()) {
        singleton.isListening = false;
        singleton.emit('no-listening');
    }
}

function fork() {
    var worker = cluster.fork();
    singleton.emit('respawn', worker);
    return worker;
}

/**
 * A worker exited
 * @param  {[type]} worker [description]
 * @param  {[type]} code   [description]
 * @param  {[type]} signal [description]
 * @return {[type]}        [description]
 */
function onExit(worker, code, signal) {
    debug('exit: ' + worker.process.pid +
        ' code: ' + code +
        ' signal: ' + signal +
        ' suicide: ' + worker.suicide);

    if (singleton.isStopping) {
        if (Object.keys(cluster.workers).length === 0) {
            stopListening();
            singleton.isStopping = false;
            singleton.emit('stopped');
            singleton.isRunning = false;
        }
    } else if (!worker.suicide) {
        debug('respawn: worker died unexpectedly');
        fork();
    }
}

function stopListening() {
    cluster.removeListener('listening', onListening);
    cluster.removeListener('disconnect', onDisconnect);
    cluster.removeListener('exit', onExit);
}

function startListening() {
    cluster.on('listening', onListening);
    cluster.on('disconnect', onDisconnect);
    cluster.on('exit', onExit);
}

Recluster.prototype.run = function run() {
    var i;

    assert(this.loose || !this.isRunning, 'You can not run when it is already running');

    this.isStopping = false;
    this.isRunning = true;
    startListening();

    for (i = 1; i <= this.nbWorkers; ++i) {
        cluster.fork();
    }
};

Recluster.prototype.reload = function reload() {
    var workersToDisconnectOnceWarmupIsDone;
    var id;
    var newWorkers;
    var tempWorker;
    var i;

    assert(this.loose || this.isRunning, 'You can not reload if it is not running');
    assert(this.loose || !this.isStopping, 'You can not reload if it is stopping');

    workersToDisconnectOnceWarmupIsDone = [];

    for (id in cluster.workers) {
        if ({}.hasOwnProperty.call(cluster.workers, id)) {
            workersToDisconnectOnceWarmupIsDone.push(id);
        }
    }

    newWorkers = [];

    function cleanup() {
        newWorkers.forEach(function(newWorker) {
            newWorker.removeListener('listening', cleanup);
        });

        workersToDisconnectOnceWarmupIsDone.forEach(function(id2) {
            if (cluster.workers[id2]) {
                cluster.workers[id2].disconnect();
            }
        });
    }

    // pre-emptive fork for no downtime
    for (i = 1; i <= this.nbWorkers; ++i) {
        debug('respawn: reload');
        tempWorker = fork();
        newWorkers.push(tempWorker);
        tempWorker.once('listening', cleanup);
    }
};

Recluster.prototype.stop = function stop() {
    assert(this.loose || this.isRunning, 'You can not stop if it is not running');
    assert(this.loose || !this.isStopping, 'You can not stop when you are already stopping');

    this.isStopping = true;
    cluster.disconnect();
};
