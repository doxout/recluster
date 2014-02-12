var numCPUs = require('os').cpus().length;
var cluster = require('cluster');
var EE      = require('events').EventEmitter;


var isProduction = process.env.NODE_ENV == 'production';

/**
 * Creates a load balancer
 * @param file          {String} path to the module that defines the server
 * @param opt           {Object} options
 * @param opt.workers   {Number} number of active workers
 * @param opt.timeout   {Number} kill timeout for old workers after reload (sec)
 * @param opt.respawn   {Number} min time between respawns when workers die
 * @param opt.backoff   {Number} max time between respawns when workers die
 * @param opt.readyWhen {String} when does the worker become ready? 'listening' or 'started'
 * @param opt.log       {Object} log to stdout (default: {respawns: true})
 * @return - the balancer. To run, use balancer.run() reload, balancer.reload()
 */
module.exports = function(file, opt) {

    opt = opt || {};
    opt.workers = opt.workers || numCPUs;
    opt.timeout = opt.timeout || (isProduction ? 3600 : 1);
    opt.readyWhen = opt.readyWhen || 'listening';
    opt.log = opt.log || {respawns: true};

    var optrespawn =  opt.respawn || 1;
    var backoffTimer;


    var self = new EE();
    var channel = new EE();

    channel.setMaxListeners(opt.workers * 4 + 10);

    self.workers = [];

    function emit() {
        channel.emit.apply(self, arguments);
        self.emit.apply(channel, arguments);
    }


    var readyEvent = opt.readyWhen == 'started' ? 'online' :
                     opt.readyWhen == 'listening' ? 'listening' :
                     'message';

    var readyCommand = 'ready';
    var disconnectCommand = 'disconnect';

    var respawners = (function() {
        var items = [];
        var self = {};
        self.cancel = function() {
            items.forEach(function(item) {
                clearTimeout(item);
            });
            items = [];
        };
        self.add = function(t) {
            items.push(t);
        };
        self.done = function(t) {
            items.splice(items.indexOf(t), 1);
        };
        return self;
    }());

    var lastSpawn = Date.now();

    function delayedDecreaseBackoff() {
        if (backoffTimer) clearTimeout(backoffTimer);
        backoffTimer = setTimeout(function() {
            backoffTimer = null;
            optrespawn = optrespawn / 2;
            if (optrespawn <= opt.respawn)
                optrespawn = opt.respawn;
            else
                delayedDecreaseBackoff();
        }, opt.backoff * 1000);
    }


    // Fork a new worker. Give it a recluster ID and
    // also redirect all its messages to the cluster.
    function fork(wid) {
        var w = cluster.fork({WORKER_ID: wid});
        w._rc_wid = wid;
        w._rc_isReplaced = false;
        w.on('message', function(message) {
            emit('message', w, message);
        });
        w.process.on('exit', function() {
            var windex = self.workers.indexOf(w);
            if (windex >= 0)
                self.workers.splice(windex, 1);
        });
        self.workers.push(w);
        return w;
    }


    // Replace a dysfunctional worker
    function workerReplace(worker) {
        if (worker._rc_isReplaced) return;
        worker._rc_isReplaced = true;

        var now = Date.now();

        if (opt.backoff)
            optrespawn = Math.min(optrespawn, opt.backoff);

        var nextSpawn = Math.max(now, lastSpawn + optrespawn * 1000),
            time = nextSpawn - now;
            lastSpawn = nextSpawn;

        // Exponential backoff.
        if (opt.backoff) {
            optrespawn *= 2;
            delayedDecreaseBackoff();
        }

        if (opt.log.respawns)
            console.log('worker #' + worker._rc_wid
                        + ' (' + worker.id + ') must be replaced, respawning in', time);
        var respawner = setTimeout(function() {
            respawners.done(respawner);
            fork(worker._rc_wid);
        }, time);

        respawners.add(respawner);

    }

    // Replace a worker that has closed the IPC channel
    // or signaled that its dysfunctional. Will also
    // terminate the worker after the specified time has
    // passed.
    function workerReplaceTimeoutTerminate(w) {
        workerReplace(w);
        killTimeout(w);
    }


    // Sets up a kill timeout for a worker. Closes the
    // IPC channel immediately.
    function killTimeout(worker) {
        var trykillfn =function() {
            try {
                if (worker.kill) {
                    worker.kill();
                } else {
                    worker.destroy();
                }
            } catch(e) {}
        }

        if (opt.timeout > 0) {
            var timeout = setTimeout(trykillfn, opt.timeout * 1000);
            worker.on('exit', clearTimeout.bind(this, timeout));
            // possible leftover worker that has no channel
            // estabilished will throw. Ignore.
            try {
                worker.send({cmd: 'disconnect'});
                worker.disconnect();
            } catch (e) { }
        } else {
            process.nextTick(trykillfn);
        }

    }

    // Redirect most events
    function workerListening(w, adr) { emit('listening', w, adr); }
    function workerOnline(w) { emit('online', w); }
    function workerDisconnect(w) { emit('disconnect', w); }
    function workerEmitExit(w) { emit('exit', w); }

    self.run = function() {
        if (!cluster.isMaster) return;
        cluster.setupMaster({exec: file});
        for (var i = 0; i < opt.workers; i++) fork(i);

        cluster.on('exit', workerEmitExit);
        cluster.on('disconnect', workerDisconnect);
        cluster.on('listening', workerListening);
        cluster.on('online', workerOnline);

        channel.on(readyEvent, function workerReady(w, arg) {
            // ignore unrelated messages when readyEvent = message
            if (readyEvent === 'message'
                && (!arg || arg.cmd != readyCommand)) return;
            emit('ready', w, arg);
        });
        // When a worker exits, try to replace it
        channel.on('exit', workerReplace);
        // When it closes the IPC channel or signals that it can no longer
        // do any processing, replace it and then set up a termination timeout
        channel.on('disconnect', workerReplaceTimeoutTerminate);
        channel.on('message', function workerDisconnectMsg(w, arg) {
            if (arg && arg.cmd === 'disconnect')
                workerReplaceTimeoutTerminate(w);
        });

    }


    self.reload = function(cb) {
        if (!cluster.isMaster) return;
        respawners.cancel();
        function allReady(cb) {
            var listenCount = opt.workers;
            var self = this;
            return function(w, arg) {
                if (!--listenCount) cb.apply(self, arguments);
            };
        }

        self.workers.forEach(function(worker) {
            var id = worker.id;

          var stopOld = allReady(function() {
                // dont respawn this worker. It has already been replaced.
                worker._rc_isReplaced = true;

                // Kill the worker after the appropriate timeout has passed
                killTimeout(worker);
                channel.removeListener('ready', stopOld);
            });

            channel.on('ready', stopOld);
        });
        if (cb) {
            var allReadyCb = allReady(function() {
                channel.removeListener('ready', allReadyCb);
                cb();
            });
            channel.on('ready', allReadyCb);
        }
        for (var i = 0; i < opt.workers; ++i) fork(i);
    };

    self.terminate = function() {
        self.stop()
        self.workers.forEach(function (worker) {
            if (worker.kill)
                worker.kill('SIGKILL');
            else
                worker.destroy();
        });
    }

    self.stop = function() {
        if (!cluster.isMaster) return;
        cluster.removeListener('exit', workerEmitExit);
        cluster.removeListener('disconnect', workerDisconnect);
        cluster.removeListener('listening', workerListening);
        cluster.removeListener('online', workerOnline);
        respawners.cancel();

        channel.removeAllListeners();
    }

    return self;
};
