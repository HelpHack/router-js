# kadro-micro-node
===

`kadro-micro-node` is a collection of modules that helps you develop against the kadro infrastructure.


## Logger
```
import {logger} from 'kadro-micro-node'

logger.info("This is info!")
logger.error("Something went wrong")
logger.fatal("Fatal! Stopping app")
```


## MQ
```
import {msgbus} from 'kadro-micro-node'

export const sampleHandler = (data, ack) => {
  console.log('Data logged: ', data);
  ack();
};

export const sampleRPCRequestHandler = (data, reply) => {
  console.log('got request for data:', data);
  reply({ result: 'Hello, world!' });
};


logger.info("This is info!")
logger.error("Something went wrong")
logger.fatal("Fatal! Stopping app")
```

## Broadcasts (MQ and Router)

a.k.a. Fanout exchange. Simple way of noticing multiple queues with one key. Producer does not care about reply nor wait.

![Fanout](https://www.cloudamqp.com/img/blog/fanout-exchange.png)

Simple receipe:

**Producer**
Simply use mq to produce fanout

```typescript=
const mq: msqbus = await createQueueManager();
await mq.broadcast(key, request); //asynchronous method
```
**key**: string - best to use standarized format, for example "entity.action" like "shift.delete", "employee.edit". One fanout - one key.

**request**: object - JS object which will be converted to JSON. Please use standard format:
```typescript=
interface BroadcastRequest {
  company_id: string;
  user_id: string;
  key: string;
  payload: Record<string, unknown>;
}
```
This way we can ensure that broadcast will versatile.


**Broadcast Queue**
Broadcast queue is implemented in Router. To use it simply call method .broadcast() as shown below:
```typescript=
registerEndpoints(): void {
    this.router.broadcast(broadcastName, keys, handler);
  }

  async webhookHandler(request: BroadcastRequest): Promise<void> {
    return this.service.doSomething(request);
  }
```

broadcast(broadcastName, keys, handler)

**broadcastName**: string - name of broadcast, used for logging purpose
**keys**: string[] - array of keys which will be handled. At lease one has to be passed. There is no limit to quantity of keys.
**handler**: function - method which will handle all broadcasts with matching key. It receives BroadcastRequest. 

*For simple implementation example please go to webhook-worker repository.*
