var numCPUs         = require('os').cpus().length
var cluster         = require('cluster')
var EE              = require('events').EventEmitter
var mkBackoff       = require('./lib/backoff')
var mkRespawners    = require('./lib/respawners')
var utils           = require('./lib/util')

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
 * @param opt.args      {Array} arguments to pass to the worker (default: [])
 * @param opt.log       {Object} what to log to stdout (default: {respawns: true})
 * @param opt.logger    {Function} logger to use, needs `log` method (default: console)
 * @return - the balancer. To run, use balancer.run() reload, balancer.reload()
 */
module.exports = function(file, opt) {

    opt = opt || {};
    opt.workers = opt.workers || numCPUs;
    opt.timeout = opt.timeout || (isProduction ? 3600 : 1);
    opt.readyWhen = opt.readyWhen || 'listening';
    opt.args = opt.args || [];
    opt.log = opt.log || {respawns: true};

    var logger     = opt.logger || console;
    var backoff    = mkBackoff({respawn: opt.respawn, backoff: opt.backoff})
    var respawners = mkRespawners()

    var self = new EE();
    var channel = new EE();

    channel.setMaxListeners(opt.workers * 4 + 10);

    var workers = [];

    var activeWorkers = {length: opt.workers};
    function deactivate(w) {
        if (activeWorkers[w._rc_wid] == w) {
            activeWorkers[w._rc_wid] = null;
        }
    }

    function emit() {
        channel.emit.apply(self, arguments);
        self.emit.apply(channel, arguments);
    }


    var readyEvent = opt.readyWhen == 'started' ? 'online' :
                     opt.readyWhen == 'listening' ? 'listening' :
                     'message';

    var readyCommand = 'ready';


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
            utils.removeFrom(workers, w);
            deactivate(w);
        });
        workers.push(w);
        return w;
    }

    // Replace a dysfunctional worker
    function workerReplace(worker) {
        if (worker._rc_isReplaced) return;
        worker._rc_isReplaced = true;

        deactivate(worker);

        var now  = Date.now()
        var time = backoff(now)

        if (opt.log.respawns) {
            logger.log('[' + worker.process.pid + '] worker (' + worker._rc_wid
                        + ':' + worker.id + ') must be replaced, respawning in', time);
        }

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
        function trykillfn() {
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
            worker.once('exit', clearTimeout.bind(this, timeout));
            // possible leftover worker that has no channel
            // estabilished will throw. Ignore.
            try {
                worker.send({cmd: 'disconnect'});
                worker.disconnect();
            } catch (e) { }
        } else {
            process.nextTick(trykillfn);
        }

        deactivate(worker);
    }


    // Redirect most events
    function workerListening(w, adr) { emit('listening', w, adr); }
    function workerOnline(w) { emit('online', w); }
    function workerDisconnect(w) { emit('disconnect', w); }
    function workerEmitExit(w) { emit('exit', w); }

    self.run = function() {
        if (!cluster.isMaster) return;
        cluster.setupMaster({exec: file});
        cluster.settings.args = opt.args;
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
        // When a worker becomes ready, add it to the active list
        channel.on('ready', function workerReady(w) {
            activeWorkers[w._rc_wid] = w;
        })

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

        workers.forEach(function(worker) {
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

    self.terminate = function(cb) {
        self.stop()
        cluster.on('exit', allDone);
        workers.forEach(function (worker) {
            if (worker.kill)
                worker.kill('SIGKILL');
            else
                worker.destroy();
        });
        allDone()
        function allDone() {
            var active = Object.keys(cluster.workers).length
            if (active === 0) {
                cluster.removeListener('exit', allDone);
                cb && cb();
            }
        }
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

    self.workers = function() {
        return workers;
    }

    self.activeWorkers = function() {
        return activeWorkers;
    }

    return self;
};
