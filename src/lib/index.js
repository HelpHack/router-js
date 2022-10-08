const url = require('url');
const logger = require('../logger/logger.js');

class Router {
  constructor(queueManager) {
    this.queueManager = queueManager;

    this.handlers = [];
    this.broadcastHandlers = [];
    this.handeledQueues = [];
    this.globalMiddleware = [];
    this.paramRegex = /\/:([^\/]+)/;

    this.start = this.start.bind(this);
    this.get = this.get.bind(this);
    this.post = this.post.bind(this);
    this.put = this.put.bind(this);
    this.delete = this.delete.bind(this);
    this.defaultHandler = this.defaultHandler.bind(this);
    this.handleRequest = this.handleRequest.bind(this);
    this.applyGlobalMiddleware = this.applyGlobalMiddleware.bind(this);
    this.use = this.use.bind(this);
  }

  start() {
    logger.info('Router starting for queues: ', this.handeledQueues);
    this.handeledQueues.forEach((queueName) => {
      this.queueManager.handleQuery(queueName, this._messageHandler.bind(this, queueName));
    });
    const handledBroadcasts = this.broadcastHandlers.map((h) => h.broadcastName);
    logger.info('Router starting for broadcasts: ', handledBroadcasts);
    this.broadcastHandlers.forEach((broadcast) => {
      const { keys, queueName, options } = broadcast;
      this.queueManager.handleBroadcast(keys, this._broadcastHandler.bind(this, broadcast), queueName, options);
    });
  }

  use(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware must be a function');
    }
    this.globalMiddleware.push(middleware);
  }

  get(queueName, path, handler) {
    this._addHandler(queueName, path, 'GET', handler);
  }

  post(queueName, path, handler) {
    this._addHandler(queueName, path, 'POST', handler);
  }

  put(queueName, path, handler) {
    this._addHandler(queueName, path, 'PUT', handler);
  }

  delete(queueName, path, handler) {
    this._addHandler(queueName, path, 'DELETE', handler);
  }

  defaultHandler(queueName, handler) {
    this._addHandler(queueName, '', '*', handler);
  }

  broadcast(broadcastName, keys, handler, queueName, options) {
    this._addBroadcast(broadcastName, keys, handler, queueName, options);
  }

  async applyGlobalMiddleware(request) {
    let index = 0;
    const middleware = this.globalMiddleware;
    const error = await next();

    async function next() {
      let handler = middleware[index++];
      if (handler) {
        return await handler(request, next);
      }
    }
    return error;
  }

  async handleBroadcast(request, broadcastHandler) {
    const { broadcastName } = broadcastHandler;
    logger.debug(`Broadcast for broadcastName: ${broadcastName}`);
    await broadcastHandler.handler(request);
    return true;
  }

  async handleRequest(request, queueName) {
    logger.debug(`Request for queue ${queueName}`, request);

    const error = await this.applyGlobalMiddleware(request);

    if (error) {
      return {
        statusCode: 500,
        data: { error },
      };
    }

    const { method, path } = request;
    const handlers = this.handlers.filter((h) => h.queueName === queueName && h.method === method);
    const { main, query } = this._extractQuerry(path);
    if (handlers) {
      for (const handle of handlers) {
        const result = main.match(handle.regexp);
        if (result) {
          logger.debug(`Request handeled by ${handle.id}`);
          const requestObj = {
            ...request,
            path: main,
            fullPaht: request.path, // Backward compatibility
            fullPath: request.path,
            params: {},
            query,
          };
          handle.params.forEach((param, i) => {
            requestObj.params[param.name] = result[i + 1];
          });
          return await handle.handler(requestObj);
        }
      }
    }
    const defaultHandler = this.handlers.find((h) => h.method === '*' && h.queueName === queueName);
    if (defaultHandler) {
      logger.debug(`Request handeled by default handler`);
      const requestObj = {
        ...request,
        path: main,
        fullPaht: request.path, // Backward compatibility
        fullPath: request.path,
        params: {},
        query,
      };
      return await defaultHandler.handler(requestObj);
    }
    logger.debug('No handler matches request');
    return {
      statusCode: 404,
      data: { error: 'not found' },
    };
  }

  _broadcastHandler(broadcastHandler, request, ack, nack) {
    this.handleBroadcast(request, broadcastHandler)
        .then((data) => {
          ack(data);
        })
        .catch((e) => {
          logger.error('Error handling broadcast:', e);
        });
  }

  _messageHandler(queueName, request, ack, nack) {
    this.handleRequest(request, queueName)
        .then((data) => {
          ack(data);
        })
        .catch((e) => {
          if (e.code === 'ECLIENT') {
            ack(e.response);
            return;
          }
          logger.error('Error handling request:', e);
          nack();
        });
  }

  _getParamIndexes(path, arr = []) {
    const result = this.paramRegex.exec(path);
    if (result === null) return arr;
    const newPath = path.slice(result.index + result[0].length);
    const last = arr[arr.length - 1] || { index: 1, length: 0 };
    return this._getParamIndexes(newPath, [
      ...arr,
      {
        name: result[1],
        length: result[0].length,
        index: last.index + last.length + result.index,
      },
    ]);
  }

  _extractQuerry(path) {
    const requestUrl = url.parse(path, true);
    const { query, pathname } = requestUrl;
    return { main: pathname, query };
  }

  _addBroadcast(broadcastName, keys, handler, queueName, options) {
    this.broadcastHandlers.push({ broadcastName, keys, handler, queueName, options });
  }

  _addHandler(queueName, path, method, handler) {
    const id = `${queueName}.${method}.${path}`;
    const conflict = this.handlers.some((h) => h.id === id);

    if (conflict) {
      throw new Error(`Handler for path '${path}' and method '${method}' already exists.`);
    }

    if (!this.handeledQueues.find((q) => q === queueName)) this.handeledQueues.push(queueName);

    // Generating regex
    const params = this._getParamIndexes(path);
    let handleRegex = path;
    let diff = 0;
    const fillRegex = '([^/]+)';
    params.forEach((param) => {
      handleRegex = `${handleRegex.slice(0, param.index - diff)}${fillRegex}${handleRegex.slice(
          param.index + param.length - diff - 1
      )}`;
      diff += param.length - fillRegex.length - 1;
    });
    handleRegex = `^${handleRegex}$`;
    handleRegex = new RegExp(handleRegex);
    // Adding new handler
    this.handlers.push({
      id,
      method,
      path,
      regexp: handleRegex,
      handler,
      queueName,
      params,
    });
  }
}

export default Router;
