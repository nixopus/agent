import Redis from 'ioredis';
import { getRedisClient } from './store';
import { createLogger } from '../logger';

let _logger: ReturnType<typeof createLogger> | null = null;
function logger() {
  if (!_logger) _logger = createLogger('pubsub');
  return _logger;
}

export type PubSubHandler = (payload: string) => void;

export interface PubSubBus {
  publish(channel: string, payload: string): void;
  subscribe(channel: string, handler: PubSubHandler): void;
  unsubscribe(channel: string): void;
  shutdown(): void;
}

class RedisPubSubBus implements PubSubBus {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<PubSubHandler>>();

  constructor(redisClient: Redis) {
    this.pub = redisClient;
    this.sub = redisClient.duplicate();
    this.sub.on('message', (channel: string, message: string) => {
      const channelHandlers = this.handlers.get(channel);
      if (!channelHandlers) return;
      for (const handler of channelHandlers) {
        try {
          handler(message);
        } catch (err) {
          logger().error({ err, channel }, 'pubsub handler error');
        }
      }
    });
  }

  publish(channel: string, payload: string): void {
    this.pub.publish(channel, payload).catch((err) => {
      logger().error({ err, channel }, 'pubsub publish error');
    });
  }

  subscribe(channel: string, handler: PubSubHandler): void {
    let channelHandlers = this.handlers.get(channel);
    if (!channelHandlers) {
      channelHandlers = new Set();
      this.handlers.set(channel, channelHandlers);
      this.sub.subscribe(channel).catch((err) => {
        logger().error({ err, channel }, 'pubsub subscribe error');
      });
    }
    channelHandlers.add(handler);
  }

  unsubscribe(channel: string): void {
    this.handlers.delete(channel);
    this.sub.unsubscribe(channel).catch(() => {});
  }

  shutdown(): void {
    for (const channel of this.handlers.keys()) {
      this.sub.unsubscribe(channel).catch(() => {});
    }
    this.handlers.clear();
    this.sub.disconnect();
  }
}

class NoopPubSubBus implements PubSubBus {
  publish(): void {}
  subscribe(): void {}
  unsubscribe(): void {}
  shutdown(): void {}
}

let bus: PubSubBus | null = null;

export function getPubSubBus(): PubSubBus {
  if (bus) return bus;
  const client = getRedisClient();
  if (client) {
    bus = new RedisPubSubBus(client);
    logger().info('PubSub bus initialized (Redis)');
  } else {
    bus = new NoopPubSubBus();
    logger().debug('PubSub bus initialized (no-op, Redis not available)');
  }
  return bus;
}

export function shutdownPubSubBus(): void {
  if (bus) {
    bus.shutdown();
    bus = null;
  }
}
