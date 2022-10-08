const jackrabbit = require('jackrabbit');
const uuid = require('uuid/v4');
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
    this.rabbit
      .default()
      .queue({ name: 'core' })
    this.rabbit
      .default()
      .queue({ name: 'directions' })
    this.rabbit
      .default()
      .queue({ name: 'search' })
    this.rabbit
      .default()
      .queue({ name: 'auth' })
    this.rabbit
      .default()
      .queue({ name: 'db-request' })
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
      console.log(
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
        console.log('AMQP succesfully reconnected');

        // We clear handlers after copying.
        const previeousHandlers = this.handlers.slice();
        const previousEventHandlers = this.eventHandlers.slice();

        this._clearHandlers();

        previeousHandlers.forEach((q) => {
          const { queueName, queueSettings, handler } = q;
          // TODO: probably differentiate another way
          // if true, then it's a query
          if (queueSettings.durable === false) {
            console.log('reconnecting query: ', queueName);
            this.handleQuery(queueName, handler);
          } else {
            console.log('reconnecting post: ', queueName);
            this.handlePost(queueName, handler);
          }
        });
        previousEventHandlers.forEach((q) => {
          const { keys, queueSettings, handler } = q;
          console.log('reconnecting broadcastHandler for: ', keys);
          this.handleBroadcast(keys, handler);
        });

        this.isHealthy = true;
        this.reconnectRetries = 0;
      });
    });
  }

  _initHealthProbes() {
    this.uuid = uuid();

    const queueName = `health_${this.uuid}`;
    console.log(`registering handler for health checks on queue ${queueName}`);
    const handler = (data, ack) => {
      console.log(`received health probe "${data}"`);
      ack('pong');
    };

    const healthProbe = async () => {
      try {
        const start =  new Date().getTime();
        const response = await this.queryHealthExchange(queueName, 'ping', undefined, 10000);
        const end =  new Date().getTime();
        console.log(`Ping->pong took ${(end-start)/1000}s`);
        if (this.reconnectRetries <= MAX_RECONNECTION_RETRIES) {
          this.isHealthy = true;

        }
        console.log(`received health probe response "${response}", rabbitmq is healthy`);
      } catch (e) {
        this.isHealthy = false;
        console.log({e})
        console.log(`rabbitmq is not healthy`);
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
    console.log(`registered handler for ${queueName}`);

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
      console.log(`Could not create new channel`, err);
    } else {
      this.channel = chan;
      this.channel.on('error', (err) => {
        console.log('Channel error', err.stack);
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
    console.log('AMQP connection is closing, with msg: ', err);
  }
  _handleConnectionError(err) {
    if (err.code === 'ENOTFOUND') {
      // This is an error which occurs when the host is unavailable.
      console.log(`could not connect to ${this.connectionString}, retrying...`);
      setTimeout(() => {
        this.reconnectOrFail();
      }, ATTEMPT_TO_RECONNECT_TIMEOUT);
      return;
    }
    console.log(`AMQP connection error, code: ${err.code}: err: ${err}`);
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
                    console.log('Error when getting payload from redis');
                    console.log(error);
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
              resolve(response);
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
    console.log(`registering post handler for ${queueName}`);
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
    console.log(`registered post handler for ${queueName}`);
  }

  // Handles post, remember that the default timeout is arround 2s.
  handleQuery(queueName, handler) {
    console.log(`registering handler for ${queueName}`);
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
    console.log(`registered handler for ${queueName}`);
  }

  // Handles broadcast, meaning, if you see a given broadcast, react to it in a specific way.
  handleBroadcast(keys, handler, queueName, options = {}) {
    console.log(`registering broadcast handler for ${keys}`);
    const queueSettings = { exclusive: true, keys, name: queueName, ...options };
    this.eventHandlers.push({ queueSettings, keys, handler });
    return this.eventExchange.queue(queueSettings).consume(handler);
  }

  _createHandlerWrapper(handler) {
    return (data, ack, nack, message) => {
      const nackWrapper = (opts) => {
        if (message.fields.redelivered) {
          const mergedOpts = Object.assign(opts || {}, { requeue: false });
          console.log('Retry failed, rejecting message');
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
              console.log(`Message to large (${dataSize} bytes). Sending 413 `);
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
            console.log('Failed to handle message', e);
            nackWrapper();
          });
        }
      } catch (e) {
        console.log('Failed to handle message', e);
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
      console.log('[mq][enableBigPayloadService] Unable to launch service. Env: ENABLE_BIG_PAYLOAD_HANDLING not set or not set to true');
      return;
    }
    this.bigPayloadService = new BigPayloadService(redisController);
  }
}

module.exports = QueueManager;
