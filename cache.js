/*
 * This module handles all IO called on the cache (currently Redis)
 */

const url = require('url');
const factory = require('./redis');
const async = require('async');
const tld = require('tldjs');


const LruCache = require('./lru');
const to = require('./to');


class Cache {
    constructor(config, options) {
        this.config = config;

        this.log = function (msg) {
            if (options.logHandler)
                options.logHandler.log(msg);
            else
                console.log(msg);
        };

        this.client = new factory(config);

        this.client.on('error', function (err) {
            this.log('DriverError ' + err);
        }.bind(this));

        this.lru = new LruCache();

        this.lru.enabled = {
            size: 100000,
            ttl: 60
        };
    }

    queryCache(query) {
        return this.lru.get(query);
    }

    addToCache(query, backends, ttl) {
        this.lru.set(query, backends, ttl * 1000 || 15 * 1000);
    }

    getDomainsLookup(hostname) {
        let parts = hostname.split('.');
        let result = [hostname];
        let n;
        // Prevent abusive lookups
        while (parts.length > 6) {
            parts.shift();
        }
        while (parts.length > 1) {
            parts.shift();
            n = parts.join('.');
            result.push('*.' + n);
        }
        result.push('*');
        return result;
    }

    readFromCache(hostKey, type, explicit = false) {
        let self = this;
        let backends = this.lru.get(type + ':' + hostKey);

        if (backends) {
            return Promise.resolve(backends.slice(0));
        }
        return new Promise(async function (resolve, reject) {


            // The entry is not in the LRU cache, let's do a request on Redis
            self.client.read(explicit ? [hostKey] : self.getDomainsLookup(hostKey), type, function (err, rows) {
                if (err) {
                    return reject(err)
                }

                backends = rows.shift();

                while (rows.length && !backends.length) {
                    backends = rows.shift();
                }

                if (!backends.length) {
                    return resolve([])
                }


                for (var i = 0,
                         j = backends.length; i < j; i++) {
                    try {
                        backends[i] = JSON.parse(backends[i])
                    } catch (e) {

                    }
                }

                self.lru.set(type + ':' + hostKey, backends, (backends[0] && backends[0].ttl * 1000) || 6000);
                resolve(backends.slice(0));
            });
        })
    }

    async getDnsFromHostType(host, type) {
        var self = this;
        return new Promise(async function (resolve, reject) {

            let [err, backends] = await to(self.readFromCache(host, type))

            if (err) {
                return reject(err)
            }

            resolve(backends)
        });
    }

    getNSList(name) {
        let self = this;
        return new Promise(async function (resolve, reject) {

            let [err, backends] = await to(self.readFromCache(name, 'NS', true))
            if (err) {
                return reject(err)
            }
            resolve(backends)
        });
    }

    getSOAList(name) {
        let self = this;
        return new Promise(async function (resolve, reject) {

            let nameservers,
                err,
                backends;


            [err, backends] = await to(self.readFromCache(name, 'SOA', true))
            if (err) {
                return reject(err)
            }

            async function setSoa(server) {

                [err, nameservers] = await to(self.getNSList('nameserver'))

                if (err) {
                    return reject(err)
                }
                let nameserver = nameservers.shift();

                var soa = {
                    "name": server.name,
                    "ttl": server.ttl,
                    "primary": nameserver.name,
                    "admin": server.admin,
                    "serial": server.serial,
                    "refresh": server.refresh,
                    "retry": server.retry,
                    "expiration": server.expiration,
                    "minimum": server.minimum
                };

                resolve(soa);
            }


            if (backends.length === 0) {
                [err, backends] = await to(self.readFromCache('nameserver', 'SOA', true))
                setSoa(backends.shift());
            } else {
                setSoa(backends.shift());
            }
        });
    }

    lookupQuestion(question, cb) {
        let self = this;
        return new Promise(async function (resolve, reject) {

            let [err, records] = await to(self.getDnsFromHostType(question.name, question.type))

            if (err) {
                return reject(err)
            }
            let results = [];

            for (let record of records) {
                results.push({
                    name: question.name,
                    type: question.type,
                    zone: tld.getDomain(question.name),
                    ttl: record.ttl,
                    priority: record.priority,
                    data: record.data
                })
            }
            resolve(results);
        })
    }

    lookupCNAME(question) {
        let self = this;
        let answers = [];
        return new Promise(async function (resolve, reject) {

            let [err, cnameRecords] = await to(self.getDnsFromHostType(question.name, 'CNAME'))

            if (err) {
                return reject(err)
            }

            for (let host of cnameRecords) {
                answers.push({
                    name: question.name,
                    type: 'CNAME',
                    zone: tld.getDomain(question.name),
                    ttl: host.ttl,
                    priority: host.priority,
                    data: host.data
                });
                try {
                    let records = await self.getDnsFromHostType(host.data, question.type)

                    for (var i = 0; i < records.length; i++) {
                        answers.push(records[i]);
                    }
                } catch (err) {

                }
            }

            resolve(answers)
        });

    };

    getAnswerList(questions) {
        let self = this;

        return new Promise(async function (resolve, reject) {
            let records;

            try {
                records = await Promise.all(questions.map(function (question) {
                    return self.lookupQuestion(question)
                }))
            } catch (err) {
                return reject(err);
            }

            if (!records) {
                return resolve([])
            }

            resolve(records.reduce(function (prev, curr) {
                return prev.concat(curr);
            }));

        });

    }
}


module.exports = Cache;