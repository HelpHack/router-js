const url = require('url');
// const logger = require('../logger/logger.js');

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
    // logger.info('Router starting for queues: ', this.handeledQueues);
    this.handeledQueues.forEach((queueName) => {
      this.queueManager.handleQuery(queueName, this._messageHandler.bind(this, queueName));
    });
    const handledBroadcasts = this.broadcastHandlers.map((h) => h.broadcastName);
    // logger.info('Router starting for broadcasts: ', handledBroadcasts);
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
    // logger.debug(`Broadcast for broadcastName: ${broadcastName}`);
    await broadcastHandler.handler(request);
    return true;
  }

  async handleRequest(request, queueName) {
    // logger.debug(`Request for queue ${queueName}`, request);

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
          // logger.debug(`Request handeled by ${handle.id}`);
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
      // logger.debug(`Request handeled by default handler`);
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
    // logger.debug('No handler matches request');
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
          // logger.error('Error handling broadcast:', e);
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
          // logger.error('Error handling request:', e);
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

const jackrabbit = require('jackrabbit');
const uuid = require('uuid');
const sizeOf = require("object-sizeof");

const MAX_RECONNECTION_RETRIES = 2;
const ATTEMPT_TO_RECONNECT_TIMEOUT = 500;

const DEFAULT_REQUEST_TIMEOUT = 60000;
const DEFAULT_MESSAGE_PREFETCH = parseInt(process.env.DEFAULT_MESSAGE_PREFETCH || '10');
const DEFAULT_LISTENERS_PER_QUEUE = process.env.LISTENERS_PER_QUEUE ? parseInt(process.env.LISTENERS_PER_QUEUE) : 10;

const MAX_MESSAGE_SIZE_BYTES = process.env.MAX_MESSAGE_SIZE_BYTES ? parseInt(process.env.MAX_MESSAGE_SIZE_BYTES) : 104857600; // default value 100 MiB

const promiseTimeout = (t = DEFAULT_REQUEST_TIMEOUT) => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('timed out'));
    }, t);
  });
};

class QueueManager {
  constructor(mqUrl = null, options = {}) {
    if (mqUrl === null) {
      logger.info('no URL declared for QueueManager using default mq from env.');
      mqUrl = `amqp://${process.env.RABBITMQ_USER}:${process.env.RABBITMQ_PASS}@${process.env.RABBIT_URL}/`;
    }

    this.connectionString = mqUrl;
    this.rabbit = jackrabbit(mqUrl);
    this._handleErrors();
    this.options = options;

    this.channel = null;

    this._onConnectionReady = this._onConnectionReady.bind(this);
    this._onChannelReady = this._onChannelReady.bind(this);

    this.rabbit.on('connected', this._onConnectionReady);

    this.exchange = this.rabbit.default(options.exchange || {});
    this.healthProbeExchange = this.rabbit.direct('healthProbeExchange',{});

    this.eventExchange = this.rabbit.topic('events');

    // QueryName <string> -> Queue   name: queueName, prefetch: 1, durable: false
    this.queryQueues = {};

    // Array<{queueName, queueSettings, handler}
    this.handlers = [];

    // Array<{keys, queueSettings, handler}
    this.eventHandlers = [];

    // Is the connection to AMQP and queues healthy?
    this.isHealthy = true;
    this.reconnectRetries = 0;

    if (process.env.NODE_ENV !== 'CI') {
      this._initHealthProbes();
    }
  }

  // Errors and reconnection
  reconnectOrFail() {
    console.warn('Reconnecting with rabbit')
    if (this.reconnectRetries > MAX_RECONNECTION_RETRIES) {
      logger.error(
          `AQMP reconnection retries attemps [${this.reconnectRetries}] exceeds max allowed [${MAX_RECONNECTION_RETRIES}], declaring unhealthy status`
      );
      this.isHealthy = false;
      this.rabbit.close();
      return;
    }

    this.reconnectRetries++;

    this.rabbit.close(()=>{
      this.rabbit = jackrabbit(this.connectionString);
      this._handleErrors();
      this.rabbit.on('connected', () => {
        logger.info('AMQP succesfully reconnected');

        // We clear handlers after copying.
        const previeousHandlers = this.handlers.slice();
        const previousEventHandlers = this.eventHandlers.slice();

        this._clearHandlers();

        previeousHandlers.forEach((q) => {
          const { queueName, queueSettings, handler } = q;
          // TODO: probably differentiate another way
          // if true, then it's a query
          if (queueSettings.durable === false) {
            logger.info('reconnecting query: ', queueName);
            this.handleQuery(queueName, handler);
          } else {
            logger.info('reconnecting post: ', queueName);
            this.handlePost(queueName, handler);
          }
        });
        previousEventHandlers.forEach((q) => {
          const { keys, queueSettings, handler } = q;
          logger.info('reconnecting broadcastHandler for: ', keys);
          this.handleBroadcast(keys, handler);
        });

        this.isHealthy = true;
        this.reconnectRetries = 0;
      });
    });
  }

  _initHealthProbes() {
    this.uuid = uuid.v4();

    const queueName = `health_${this.uuid}`;
    logger.debug(`registering handler for health checks on queue ${queueName}`);
    const handler = (data, ack) => {
      logger.debug(`received health probe "${data}"`);
      ack('pong');
    };

    const healthProbe = async () => {
      try {
        const start =  new Date().getTime();
        const response = await this.queryHealthExchange(queueName, 'ping', undefined, 10000);
        const end =  new Date().getTime();
        logger.debug(`Ping->pong took ${(end-start)/1000}s`);
        if (this.reconnectRetries <= MAX_RECONNECTION_RETRIES) {
          this.isHealthy = true;

        }
        logger.info(`received health probe response "${response}", rabbitmq is healthy`);
      } catch (e) {
        this.isHealthy = false;
        logger.info(`rabbitmq is not healthy`);
      }
    };

    const queueSettings = {
      name: queueName,
      prefetch: DEFAULT_MESSAGE_PREFETCH,
      durable: false,
      autoDelete: true,
      key: queueName,
    };

    this.healthProbeExchange.queue(queueSettings).consume(handler);
    logger.debug(`registered handler for ${queueName}`);

    this.healthProbe = setInterval(healthProbe, 10000);
  }

  _onConnectionReady() {
    this.rabbitInternals = this.rabbit.getInternals();
    if (this.options.createChannel) {
      this.rabbitInternals.connection.createChannel(this._onChannelReady);
    }
  }
  _onChannelReady(err, chan) {
    if (err) {
      logger.error(`Could not create new channel`, err);
    } else {
      this.channel = chan;
      this.channel.on('error', (err) => {
        logger.error('Channel error', err.stack);
      });
    }
  }

  _clearHandlers() {
    this.handlers = [];
    this.eventHandlers = [];

    // TODO: Should we explicitly close connections here by iterating over the registered queues?
    this.queryQueues = {};
  }

  _handleCloseEvent(err) {
    logger.info('AMQP connection is closing, with msg: ', err);
  }
  _handleConnectionError(err) {
    if (err.code === 'ENOTFOUND') {
      // This is an error which occurs when the host is unavailable.
      logger.info(`could not connect to ${this.connectionString}, retrying...`);
      setTimeout(() => {
        this.reconnectOrFail();
      }, ATTEMPT_TO_RECONNECT_TIMEOUT);
      return;
    }
    logger.error(`AMQP connection error, code: ${err.code}: err: ${err}`);
    setTimeout(() => {
      this.reconnectOrFail();
    }, ATTEMPT_TO_RECONNECT_TIMEOUT);
  }

  _handleErrors() {
    this.rabbit.on('error', (err) => {
      this._handleConnectionError(err);
    });
    this.rabbit.on('close', (err) => {
      this._handleCloseEvent(err);
    });
  }
  // END Errors and reconnection

  // TODO: Deprecated?
  init() {
    console.log('KadroQueueManager started');
  }

  bail(errorStr = '') {
    this.rabbit.bail(errorStr);
  }

  stop() {
    if (this.channel) this.channel.close();
    const rabbit = this.rabbit;
    return new Promise((resolve, reject) => {
      rabbit.close(resolve);
    });
    clearInterval(this.healthProbe);
  }

  _broadcast(key, payload) {
    this.eventExchange.publish(
        { ...payload, key },
        {
          key,
        }
    );
  }

  _publish(key, payload) {
    return this.exchange.publish(payload, {
      key,
    });
  }

  _publishAndWaitForReply(key, payload, options = {}) {
    return new Promise((resolve, reject) => {
      this.exchange.publish(
          payload,
          Object.assign(options, {
            key,
            reply: (response) => {
              const { error } = response;
              if (error && error !== null) {
                reject(error);
              } else {
                if (this.bigPayloadService) {
                  this.bigPayloadService
                      .handleResponse(response)
                      .then((responseWithData) => {
                        resolve(responseWithData);
                      })
                      .catch((error) => {
                        logger.error('Error when getting payload from redis');
                        logger.error(error);
                        reject(error);
                      });
                } else {
                  resolve(response);
                }
              }
            },
          })
      );
    });
  }

  _publishAndWaitForReplyInHealthExchange(key, payload, options = {}) {
    return new Promise((resolve, reject) => {
      this.healthProbeExchange.publish(
          payload,
          Object.assign(options, {
            key,
            reply: (response) => {
              const { error } = response;
              if (error && error !== null) {
                reject(error);
              } else {
                if (this.bigPayloadService) {
                  this.bigPayloadService
                      .handleResponse(response)
                      .then((responseWithData) => {
                        resolve(responseWithData);
                      })
                      .catch((error) => {
                        logger.error('Error when getting payload from redis');
                        logger.error(error);
                        reject(error);
                      });
                } else {
                  resolve(response);
                }
              }
            },
          })
      );
    });
  }

  /**
   *  Query is an RPC call, meaning you await for the response from the target service
   *
   * @param {string} name - Name of the service / queue.
   * @param {Object} payload - Javascript object that is later serialized to JSON that contains all the req. info.
   * @param {Number} t - Integer -> time out in ms.
   * @returns {Promise} Returns a promise.
   */
  query(name, payload, options, t = DEFAULT_REQUEST_TIMEOUT) {
    const withTimeout = Object.assign({}, options);
    withTimeout.expiration = withTimeout.expiration || `${t}`;
    return Promise.race([this._publishAndWaitForReply(name, payload, withTimeout), promiseTimeout(t)]);
  }

  queryHealthExchange(name, payload, options, t = DEFAULT_REQUEST_TIMEOUT) {
    const withTimeout = Object.assign({}, options);
    withTimeout.expiration = withTimeout.expiration || `${t}`;
    return Promise.race([this._publishAndWaitForReplyInHealthExchange(name, payload, withTimeout), promiseTimeout(t)]);
  }

  /**
   *  Post is an MQ call that does not require the other service to receive feedback
   *
   * @param {string} name - Name of the service / queue.
   * @param {Object} payload - Javascript object that is later serialized to JSON that contains all the req. info.
   * @returns {Promise} Returns a promise.
   */
  post(name, payload) {
    return this._publish(name, payload);
  }

  /**
   *  Broadcast is an MQ call that does not require the other service to receive feedback
   *
   * @param {string} name - Name of the service / queue.
   * @param {Object} payload - Javascript object that is later serialized to JSON that contains all the req. info.
   * @returns {Promise} Returns a promise.
   */
  broadcast(key, payload) {
    return this._broadcast(key, payload);
  }

  // Handles post, remember that the default timeout is arround 2s.
  handlePost(queueName, handler) {
    logger.debug(`registering post handler for ${queueName}`);
    const wrapper = this._createHandlerWrapper(handler);
    const queueSettings = {
      name: queueName,
      prefetch: 1,
      durable: true,
    };
    for (let i = 0; i < DEFAULT_LISTENERS_PER_QUEUE; i++) {
      this.queryQueues[`${queueName}-${i}`] = this.exchange.queue(queueSettings);
      this.queryQueues[`${queueName}-${i}`].consume(wrapper);
    }
    this.handlers.push({ queueSettings, queueName });
    logger.debug(`registered post handler for ${queueName}`);
  }

  // Handles post, remember that the default timeout is arround 2s.
  handleQuery(queueName, handler) {
    logger.debug(`registering handler for ${queueName}`);
    const wrapper = this._createHandlerWrapper(handler);
    const queueSettings = {
      name: queueName,
      prefetch: DEFAULT_MESSAGE_PREFETCH,
      durable: false,
    };

    for (let i = 0; i < DEFAULT_LISTENERS_PER_QUEUE; i++) {
      this.queryQueues[`${queueName}-${i}`] = this.exchange.queue(queueSettings);
      this.queryQueues[`${queueName}-${i}`].consume(wrapper);
    }

    this.handlers.push({ queueSettings, queueName, handler });
    logger.debug(`registered handler for ${queueName}`);
  }

  // Handles broadcast, meaning, if you see a given broadcast, react to it in a specific way.
  handleBroadcast(keys, handler, queueName, options = {}) {
    logger.info(`registering broadcast handler for ${keys}`);
    const queueSettings = { exclusive: true, keys, name: queueName, ...options };
    this.eventHandlers.push({ queueSettings, keys, handler });
    return this.eventExchange.queue(queueSettings).consume(handler);
  }

  _createHandlerWrapper(handler) {
    return (data, ack, nack, message) => {
      const nackWrapper = (opts) => {
        if (message.fields.redelivered) {
          const mergedOpts = Object.assign(opts || {}, { requeue: false });
          logger.error('Retry failed, rejecting message');
          nack(mergedOpts);
        } else {
          nack(opts);
        }
      };

      const ackWrapper = (reply) => {
        if (this.bigPayloadService) {
          this.bigPayloadService
              .handleQueryHandlerReply(reply)
              .then(ack)
              .catch((e) => nackWrapper());
        } else {
          try{
            const dataSize = sizeOf(reply.data || '');
            if( dataSize > MAX_MESSAGE_SIZE_BYTES ){
              logger.warn(`Message to large (${dataSize} bytes). Sending 413 `);
              ack({statusCode:413, data:{message:`Data to large (size: ${dataSize} bytes)`}});
              return;
            }
          }catch (e){}
          ack(reply);
        }
      };

      try {
        const value = handler(data, ackWrapper, nackWrapper, message);
        if (value instanceof Promise) {
          value.then(ackWrapper).catch((e) => {
            logger.error('Failed to handle message', e);
            nackWrapper();
          });
        }
      } catch (e) {
        logger.error('Failed to handle message', e);
        nackWrapper();
      }
    };
  }

  checkIfQueueExists(name) {
    return new Promise((resolve, reject) => {
      if (this.channel) {
        try {
          this.channel.checkQueue(name, (err, data) => {
            resolve({ exists: data && data.consumerCount > 0, details: data });
          });
        } catch (err) {
          resolve({ exists: false, details: err });
        }
      } else {
        resolve({ exists: false });
      }
    });
  }

  // Like broadcast, but defines a specific queue on which only one application will listen.
  // For example if you want to make sure that an event is only processed once
  // (although no guarantees will be made)
  handleMulticast() {}

  enableBigPayloadService(redisController) {
    const bigPayloadEnv = process.env.ENABLE_BIG_PAYLOAD_HANDLING;
    const bigPayloadHandlingNotEnabled = !bigPayloadEnv || bigPayloadEnv !== 'true';
    if (bigPayloadHandlingNotEnabled) {
      logger.debug('[mq][enableBigPayloadService] Unable to launch service. Env: ENABLE_BIG_PAYLOAD_HANDLING not set or not set to true');
      return;
    }
    this.bigPayloadService = new BigPayloadService(redisController);
  }
}

export {
  Router,
    QueueManager
}
