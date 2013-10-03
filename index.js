var numCPUs = require('os').cpus().length;
var cluster = require('cluster');
var EE      = require('events').EventEmitter;


function each(obj, fn) { for (var key in obj) fn(key, obj[key]); }


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


    var readyEvent = opt.readyWhen == 'started' ? 'online' :
                     opt.readyWhen == 'listening' ? 'listening' :
                     'message';

    var readyCommand = 'ready';

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

    function workerExit(worker) {
        self.emit('exit', worker);
        if (worker.suicide) return;
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
                        + ' (' + worker.id + ') died, respawning in', time);
        var respawner = setTimeout(function() {
            respawners.done(respawner);
            cluster.fork({WORKER_ID: worker._rc_wid})._rc_wid = worker._rc_wid;
        }, time);

        respawners.add(respawner);

    }
    function workerListening(w, adr) { self.emit('listening', w, adr); }
    function workerOnline(w) { self.emit('online', w); }
    function workerDisconnect(w) { self.emit('disconnect', w); }



    function redirectWorkerMessage(worker) {
        return function(message) {
            self.emit('message', worker, message);
        }
    };

    self.run = function() {
        if (!cluster.isMaster) return;
        cluster.setupMaster({exec: file});
        for (var i = 0; i < opt.workers; i++) {
            var w = cluster.fork({WORKER_ID: i});
            w._rc_wid = i;
            w.on('message', redirectWorkerMessage(w));
        }

        cluster.on('exit', workerExit);
        cluster.on('disconnect', workerDisconnect);
        cluster.on('listening', workerListening);
        cluster.on('online', workerOnline);

        self.on(readyEvent, function workerReady(w, arg) {
            // ignore unrelated messages when readyEvent = message
            if (readyEvent == 'message'
                && (!arg || arg.cmd != readyCommand)) return;
            self.emit('ready', w, arg);
        });

    }

    self.reload = function() {
        if (!cluster.isMaster) return;
        respawners.cancel();

        each(cluster.workers, function(id, worker) {

           function allReady(cb) {
               var listenCount = opt.workers;
               var self = this;
               return function(w, arg) {
                   if (!--listenCount) cb.apply(self, arguments);
               };
           }
           var stopOld = allReady(function() {
                var killfn = worker.kill ? worker.kill.bind(worker)
                                         : worker.destroy.bind(worker);
                if (opt.timeout > 0) {
                    var timeout = setTimeout(killfn, opt.timeout * 1000);
                    worker.on('exit', clearTimeout.bind(this, timeout));
                    // possible leftover worker that has no channel 
                    // estabilished will throw. Ignore.
                    try { worker.send({cmd: 'disconnect'}); }
                    catch (e) { }
                } else {
                    killfn();
                }
                // possible leftover worker that has no channel estabilished
                // will throw
                try { worker.disconnect(); } catch (e) { }
                self.removeListener('ready', stopOld);
            });

            self.on('ready', stopOld);
        });
        for (var i = 0; i < opt.workers; ++i) {
            var w = cluster.fork({WORKER_ID: i});
            w._rc_wid = i;
            w.on('message', redirectWorkerMessage(w));
        }
    };

    self.terminate = function() {
        if (!cluster.isMaster) return;
        cluster.removeListener('exit', workerExit);
        cluster.removeListener('disconnect', workerDisconnect);
        cluster.removeListener('listening', workerListening);
        cluster.removeListener('online', workerOnline);
        respawners.cancel();
        each(cluster.workers, function(id, worker) {
            if (worker.kill)
                worker.kill('SIGKILL');
            else
                worker.destroy();
        });
        self.removeAllListeners();
    }

    return self;

};
