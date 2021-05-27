#!/usr/bin/env node

var program = require('commander');
var cluster = require('cluster');
var path = require('path');
var async = require('async');
var tld = require('tldjs');
var Logger = require('raft-logger-redis').Logger;


var N = require('../nameserver')
var dnsd = require('../')

program.version(require('../package.json').version);

var server = program.command('server');
server.description('Run the nameserver.');

server.option('-i, --ipv6', 'use ipv6 (default: false)', false);
server.option('-I, --ipv6-addr [HOST]', 'use ipv6 (default: ::)', "::");
server.option('-a, --addr [HOST]', 'Bind to HOST address (default: 127.0.0.1)', '127.0.0.1');
server.option('-p, --port [PORT]', 'Use PORT (default: 53)', 53);
server.option('-p, --port-udp [PORT-UDP]', 'Use PORT (default: 53)', 53);
server.option('-A, --redis-addr [HOST]', 'Connect to redis HOST address (default: 127.0.0.1)', '127.0.0.1');
server.option('-P, --redis-port [PORT]', 'Connect to redis PORT (default: 6379)', 6379);
server.option('-o, --redis-auth [PASSWORD]', 'Use redis auth');
server.option('-t, --tcp', 'Start TCP-Server', false);
server.option('-u, --udp', 'Start UDP-Server', false);
server.option('-c, --cluster', 'Start server as cluster', false);

server.option('-L, --proxy', 'Proxy DNS (default: false)', false);

server.option('-l, --logging', 'Start logging (default: false)', false);
server.option('-v, --log-udp-port [LOG-UDP-PORT]', 'Use PORT (default: 5001)', 5001);
server.option('-x, --log-tcp-port [LOG-TCP-PORT]', 'Use PORT (default: 5000)', 5000);
server.option('-y, --log-host [HOST]', 'Use HOST (default: 127.0.0.1)', '127.0.0.1');
server.option('-z, --session [SESSION]', 'Use SESSION (default: dns)', 'DNS');
server.option('-f, --channel [CHANNEL]', 'Use CHANNEL (default: ns.0)', 'ns.0');
server.option('-g, --source [SOURCE]', 'Use SOURCE (default: dns)', 'dns');
server.action(function (options) {

    var logHandler;
    var redis = {
        host: options.redisAddr,
        port: options.redisPort
    };

    if (options.redisAuth) {
        redis.auth = options.redisAuth;
    }

    if (options.logging) {
        var logs = Logger.createLogger({
            "web": {
                "port": options.logTcpPort,
                "host": options.logHost
            },
            "udp": {
                "port": options.logUdpPort,
                "host": options.logHost
            },
            "view": {
                "port": options.logTcpPort,
                "host": options.logHost
            }
        });

        logHandler = logs.create({
            source: options.source,
            channel: options.channel,
            session: options.session,
            bufferSize: 1
        });
    }
    console.log('server.action', options.cluster)

    var cache = new (require('../cache'))(redis, {
        logHandler: logHandler || console,
        proxy:options.proxy
    });

    var n = new N(cache, logHandler || console)

    if (options.cluster) {
        var numCPUs = require('os').cpus().length;
        if (cluster.isMaster) {
            for (var i = 0; i < numCPUs; i++)
                cluster.fork();
            cluster.on('exit', function(worker, code, signal) {
                var m = 'Worker died (pid: ' + worker.process.pid + ', suicide: ' + (worker.suicide === undefined ? 'false' : worker.suicide.toString());
                if (worker.suicide === false) {
                    if (code !== null) {
                        m += ', exitcode: ' + code;
                    }
                    if (signal !== null) {
                        m += ', signal: ' + signal;
                    }
                }
                m += '). Spawning a new one.';
                console.log(m);
                cluster.fork();
            })

        } else {
            setupServer()
        }
    } else {
        setupServer();
    }

    function setupServer() {

        var server = dnsd.createServer(function (req, res) {

            n.handler(req, res)
        })
        console.log(options.port, options.addr)
        server.listen(options.port, options.addr)
    }


});

program.parse(process.argv);

if (!program.args.length)
    program.help();