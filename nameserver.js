const tld = require('tldjs');

const to = require('./to')
a = {
    "name": "nodetopia.com",
    "ttl": 3600,
    "admin": "hostmaster.nodetopia.com",
    "serial": 2003080800,
    "refresh": 172800,
    "retry": 900,
    "expiration": 1209600,
    "minimum": 86400
}

class Nameserver {
    constructor(store, console) {
        this.store = store;
        this.console = console;
    }

    async handler(req, res) {
        let self = this;
        let question = req.question[0];

        req.question.forEach(function (q) {
            q.name = q.name.toLowerCase()
        })

        let {name, type} = question;

        if (this[type]) {
            try {
                await this[type](req, res)
            } catch (err) {
                console.log(err)
            }
        } else {

            try {
                await this.handleAll(req, res)
            } catch (err) {
                console.log(err)

            }
        }

        res.end()


        req.question.forEach(function (q) {
            self.console.log('%s:%s/%s %s %s %j %j', req.connection.remoteAddress, req.connection.remotePort, req.connection.type, q.name, q.type, res.answer, res.additional)

        })


    }

    handleAll(req, res) {
        let self = this;

        return new Promise(async function (resolve, reject) {

            let [err, zones] = await to(self.store.getAnswerList(req.question))

            if (err || !zones) {
                return reject(err || new Error('no zone'));
            }
            for (let zone of zones) {
                res.answer.push(zone);
            }

            resolve();
        })

    }

    AAAA(req, res) {
        let self = this;
        let question = req.question[0];
        let {name} = question;
        return new Promise(async function (resolve, reject) {


            let [err, zones] = await to(self.store.getAnswerList(req.question))

            if (err || !zones) {
                return reject(err || new Error('no zone'));
            }

            for (let zone of zones) {
                res.answer.push({
                    name: zone.name,
                    type: 'AAAA',
                    data: Nameserver.expandIPv6Address(zone.data),
                    ttl: zone.ttl
                });
            }

            resolve();

        })

    }

    MX(req, res) {
        let self = this;
        let question = req.question[0];
        let {name} = question;
        return new Promise(async function (resolve, reject) {


            let [err, zones] = await to(self.store.getAnswerList(req.question))

            if (err || !zones) {
                return reject(err || new Error('no zone'));
            }

            for (let zone of zones) {
                res.answer.push({
                    name: zone.name,
                    type: 'MX',
                    data: [zone.priority, zone.data],
                    ttl: zone.ttl
                });
            }

            resolve();

        })

    }

    SOA(req, res) {
        let self = this;
        let question = req.question[0];
        let {name} = question;
        return new Promise(async function (resolve, reject) {


            let [err, soa] = await to(self.store.getSOAList(tld.getDomain(name.replace('*', ''))))

            if (err) {
                return reject(err);
            }
            res.answer.push({
                'class': 'IN'
                , 'type': 'SOA'
                , 'name': name
                , 'data': {
                    'mname': name
                    , 'rname': soa.admin
                    , 'serial': soa.serial
                    , 'refresh': soa.refresh
                    , 'retry': soa.retry
                    , 'expire': soa.expiration
                    , 'ttl': soa.ttl
                }
            });
            resolve()
        })
    }

    NS(req, res) {
        let self = this;
        let question = req.question[0];
        let {name} = question;
        return new Promise(async function (resolve, reject) {


            let [err, nameservers] = await to(self.store.getNSList(tld.getDomain(name.replace('*', ''))))

            if (err) {
                return reject(err);
            }

            let promises = [];
            nameservers.forEach(function (ns) {
                res.answer.push({
                    type: 'NS',
                    name: name,
                    data: ns.data,
                    ttl: ns.ttl
                });

                promises.push(self.store.getDnsFromHostType(ns.data, 'A'))
                promises.push(self.store.getDnsFromHostType(ns.data, 'AAAA'))

            });

            try {
                let result = await Promise.all(promises)

                result.forEach(function (result) {
                    for (let record of result) {
                        if (record.type === 'AAAA') {
                            res.additional.push({
                                type: 'AAAA',
                                name: record.name,
                                data: self.expandIPv6Address(record.data),
                                ttl: record.ttl
                            });
                        } else {
                            res.additional.push({
                                type: 'A',
                                name: record.name,
                                data: record.data,
                                ttl: record.ttl
                            });
                        }
                    }
                })
                resolve();
            } catch (err) {
                reject(err)
            }
        });
    }

   static expandIPv6Address(address) {
        var fullAddress = "";
        var expandedAddress = "";
        var validGroupCount = 8;
        var validGroupSize = 4;

        var ipv4 = "";
        var extractIpv4 = /([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/;
        var validateIpv4 = /((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})/;

        // look for embedded ipv4
        if (validateIpv4.test(address)) {
            groups = address.match(extractIpv4);
            for (var i = 1; i < groups.length; i++) {
                ipv4 += ("00" + (parseInt(groups[i], 10).toString(16))).slice(-2) + (i == 2 ? ":" : "");
            }
            address = address.replace(extractIpv4, ipv4);
        }

        if (address.indexOf("::") === -1) // All eight groups are present.
            fullAddress = address;
        else // Consecutive groups of zeroes have been collapsed with "::".
        {
            var sides = address.split("::");
            var groupsPresent = 0;
            for (var i = 0; i < sides.length; i++) {
                groupsPresent += sides[i].split(":").length;
            }
            fullAddress += sides[0] + ":";
            for (var i = 0; i < validGroupCount - groupsPresent; i++) {
                fullAddress += "0000:";
            }
            fullAddress += sides[1];
        }
        var groups = fullAddress.split(":");
        for (var i = 0; i < validGroupCount; i++) {
            while (groups[i].length < validGroupSize) {
                groups[i] = "0" + groups[i];
            }
            expandedAddress += (i !== validGroupCount - 1) ? groups[i] + ":" : groups[i];
        }
        return expandedAddress;
    }
}

module.exports = Nameserver;

