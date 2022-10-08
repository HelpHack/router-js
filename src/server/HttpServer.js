const MetricsController = require('./MetricsController');
const HealthController = require('./HealthController');
const http = require("http");
const querystring = require("querystring");

function defaultDefaultHandler(req, res) {
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}

class HttpServer {
  constructor(port, healthProviders = [], defaultHandler = defaultDefaultHandler) {
    this.port = port;
    this.metricsController = new MetricsController();
    this.heatlhController = new HealthController(healthProviders);
    this.server = http.createServer(this.handleHttpRequest.bind(this));
    this.addRequestHandler = this.addRequestHandler.bind(this);

    if (typeof defaultHandler !== 'function') {
      throw new Error('defaultHandler should be a function');
    }

    this.defaultHandler = defaultHandler;

    this.handlers = [
      { method:'GET', path:'/healthz', handler: this.handleHealthzRequest.bind(this) },
      { method:'GET', path:'/metrics', handler: this.handleMetricsRequest.bind(this) },
    ];

  }

  start() {
    return this.server.listen(this.port);
  }

  close() {
    return new Promise((accept, reject) => {
      try {
        this.server.close(accept);
      } catch (e) {
        reject(e);
      }

    });
  }

  addRequestHandler(method, path, handler){
    const requestHandler = this.handlers.find(i=>i.method === method && i.path === path);
    const newHandler =  { method, path, handler };
    if(requestHandler){
      this.handlers = this.handlers.map(i=>{
        if(i.method === method && i.path === path) return newHandler;
        return i;
      });
    }else{
      this.handlers.push(newHandler);
    }
  }

  handleHealthzRequest(req, res){
    this.heatlhController.nodeEndpoint(req, res)
      .catch(e => console.log("Unexpected error", e));
  }

  handleMetricsRequest(req, res){
    this.metricsController.getMetrics(req, res);
  }

  handleHttpRequest(req, res) {
    const [path, query] = req.url.split('?');
    const queryObject = this._parseQuery(query);

    const requestHandler = this.handlers.find(i=>i.method === req.method && i.path === path);

    if(!requestHandler){
      this.defaultHandler(req, res);
      return;
    }
    req.query = queryObject;
    requestHandler.handler(req,res);
  }

  _parseQuery(query) {
    if (!query) return {};
    const qs = querystring.parse(query);
    return qs;
  }

}

module.exports = HttpServer;
