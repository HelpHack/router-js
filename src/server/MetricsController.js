const client = require("prom-client");

if (process.env.NODE_ENV !== 'CI') {
  client.collectDefaultMetrics({ timeout: 5000 });
}

class MetricsController {
    getMetrics(req, res) {
        res.writeHead(200, { "Content-Type": "text/plain;charset=utf-8" });
        res.end(client.register.metrics());
    }
}

module.exports = MetricsController;
