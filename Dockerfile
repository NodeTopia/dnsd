from   node:16



run mkdir /dnsd
add . /dnsd

run npm install /dnsd

expose  53

cmd ["sh", "-c","node /dnsd/bin/nameserver.js server -tucl --channel ${LOGGING_CHANNEL} --log-udp-port ${LOGGER_PORT_5001_UDP_PORT} --log-tcp-port ${LOGGER_PORT_5000_TCP_PORT} --log-host ${LOGGER_PORT_5000_TCP_ADDR} --addr 0.0.0.0 --redis-addr ${DB_PORT_6379_TCP_ADDR} --redis-port ${DB_PORT_6379_TCP_PORT} --redis-auth ${DB_ENV_REDIS_PASS}"]