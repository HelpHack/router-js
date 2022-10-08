const QueueManager = require('./mq.js');
require('events').EventEmitter.defaultMaxListeners = 15;
const logger = require('../logger/logger.js');

const localMQUrl = 'amqp://guest:guest@localhost:5672/';


const sleep = ms => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const testHandler = async (data, reply) => {
  // Doing stuff
  reply(data);
};

describe('QueueManager ', () => {
  it('initializes properly', async done => {
    let q = new QueueManager(localMQUrl);
    await q.stop();
    done();
  });

  it('properly handles GET/RPC', async done => {
    let q = new QueueManager(localMQUrl);
    q.handleQuery('test-queue', testHandler);
    await sleep(200);

    try {
      const res = await q.query('test-queue', { field: 'output' });
      expect(res.field).toBe('output');
    } catch (error) {
      console.error('failed with: ', error);
      throw error;
    }
    await q.stop();
    done();
  });

  it('properly handles error', async done => {
    let q = new QueueManager(localMQUrl);
    q.init();
    q.handleQuery('test-error-queue', testHandler);

    await sleep(200);
    q.query('test-error-queue', { field: 'output', error: 'could not process stuff' })
      .then(res => {
        logger.info(res);
        throw new Error('this should not get invoked');
      })
      .catch(err => {
        logger.info('Success!');
      });
    await q.stop();
    done();
  });

  it('properly handles POST', async done => {
    let receivedMessages = 0;
    const targetReceived = 2;
    const handler = (data, ack) => {
      receivedMessages += 1;
      ack();
    };

    let q = new QueueManager(localMQUrl);

    q.init();
    q.handlePost('test-post', handler);
    await sleep(200);

    q.post('test-post', { sample: 'input' });
    q.post('test-post', { sample: 'input' });
    await sleep(200);

    expect(receivedMessages).toBe(targetReceived);
    await q.stop();
    done();
  });

  it('properly handles BROADCAST', async done => {
    let listener = new QueueManager(localMQUrl);
    let triggered = false;
    const handler = (data, ack) => {
      logger.info('triggering');
      ack();
      triggered = true;
    };

    listener.handleBroadcast(['workers.*', 'toster'], handler);

    await sleep(200);

    let testPublisher = new QueueManager(localMQUrl);
    testPublisher.broadcast('workers.testQueue', { text: 'petarda' });
    // for (let x = 0; x < numberOfListeners; x++) {
    //   expect(listenerReceived[x]).toBe(true);
    // }

    await sleep(200);
    expect(triggered).toBe(true);
    await listener.stop();
    await testPublisher.stop();
    done();
  });
});
