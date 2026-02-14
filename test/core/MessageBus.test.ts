/**
 * MessageBus Tests
 *
 * Tests pub/sub communication, message routing, and agent coordination.
 * Note: MessageBus wraps data in a Message object with .data property.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageBus, Message } from '../../packages/agents/src/core/MessageBus';

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  describe('subscribe', () => {
    it('should register subscriber for topic', () => {
      const handler = vi.fn();

      bus.subscribe('test.topic', handler);

      expect((bus as any).subscribers.has('test.topic')).toBe(true);
    });

    it('should allow multiple subscribers for same topic', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.subscribe('test.topic', handler1);
      bus.subscribe('test.topic', handler2);

      bus.publish('test.topic', { data: 'test' });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();

      const unsubscribe = bus.subscribe('test.topic', handler);
      unsubscribe();

      bus.publish('test.topic', { data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('should deliver message to all subscribers', async () => {
      const received: Message[] = [];

      bus.subscribe('test.topic', (msg) => received.push(msg));

      await bus.publish('test.topic', { message: 'hello' });

      expect(received).toHaveLength(1);
      // Data is wrapped in Message object
      expect(received[0].data.message).toBe('hello');
    });

    it('should handle async subscribers', async () => {
      let processed = false;

      bus.subscribe('async.topic', async () => {
        await new Promise(r => setTimeout(r, 10));
        processed = true;
      });

      await bus.publish('async.topic', {});

      // EventEmitter fires handlers synchronously but doesn't wait for async completion
      // So we need to wait for the async handler to complete
      await new Promise(r => setTimeout(r, 50));

      expect(processed).toBe(true);
    });

    it('should not throw if no subscribers', async () => {
      await expect(bus.publish('nonexistent.topic', {})).resolves.not.toThrow();
    });

    it('should include message metadata', async () => {
      let receivedMsg: Message | null = null;

      bus.subscribe('test.topic', (msg) => {
        receivedMsg = msg;
      });

      await bus.publish('test.topic', { test: true }, { from: 'test-agent' });

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.id).toBeDefined();
      expect(receivedMsg!.topic).toBe('test.topic');
      expect(receivedMsg!.from).toBe('test-agent');
      expect(receivedMsg!.timestamp).toBeDefined();
    });
  });

  describe('agent routing', () => {
    it('should route messages between agents', async () => {
      const scoutMessages: Message[] = [];
      const analystMessages: Message[] = [];

      bus.subscribe('agent.scout.scan', (msg) => scoutMessages.push(msg));
      bus.subscribe('agent.analyst.investigate', (msg) => analystMessages.push(msg));

      // Scout discovers token
      await bus.publish('agent.scout.scan', { token: 'Token123' });

      // Scout flags for analyst
      await bus.publish('agent.analyst.investigate', {
        token: 'Token123',
        score: 65,
        flags: ['suspicious'],
      });

      expect(scoutMessages).toHaveLength(1);
      expect(analystMessages).toHaveLength(1);
      expect(analystMessages[0].data.token).toBe('Token123');
    });

    it('should support sendTo helper method', async () => {
      const received: Message[] = [];

      bus.subscribe('agent.analyst.investigation', (msg) => received.push(msg));

      await bus.sendTo('analyst', 'investigation', { token: 'Test' }, 'scout');

      expect(received).toHaveLength(1);
      expect(received[0].from).toBe('scout');
    });
  });

  describe('message types', () => {
    it('should handle investigation requests', async () => {
      let received: Message | null = null;

      bus.subscribe('agent.analyst.investigate', (msg) => {
        received = msg;
      });

      await bus.publish('agent.analyst.investigate', {
        token: 'TestToken',
        score: 55,
        flags: ['low_liquidity', 'concentrated'],
        features: new Array(29).fill(0.5),
        priority: 'high',
      });

      expect(received).not.toBeNull();
      expect(received!.data.token).toBe('TestToken');
      expect(received!.data.flags).toContain('concentrated');
    });

    it('should handle trade signals', async () => {
      let signal: Message | null = null;

      bus.subscribe('agent.trader.signal', (msg) => {
        signal = msg;
      });

      await bus.publish('agent.trader.signal', {
        token: 'BuyToken',
        action: 'BUY',
        price: 0.0001,
        amount: 0.5,
        reason: 'Safe score, good liquidity',
      });

      expect(signal).not.toBeNull();
      expect(signal!.data.action).toBe('BUY');
    });
  });

  describe('history', () => {
    it('should track message history', async () => {
      await bus.publish('test.1', { n: 1 });
      await bus.publish('test.2', { n: 2 });
      await bus.publish('test.3', { n: 3 });

      const history = bus.getHistory(3);

      expect(history).toHaveLength(3);
      expect(history[0].data.n).toBe(1);
      expect(history[2].data.n).toBe(3);
    });

    it('should limit history size', async () => {
      for (let i = 0; i < 10; i++) {
        await bus.publish('test', { i });
      }

      const history = bus.getHistory(5);
      expect(history.length).toBeLessThanOrEqual(5);
    });
  });

  describe('subscriber management', () => {
    it('should track subscriber count', () => {
      bus.subscribe('test.topic', () => {});
      bus.subscribe('test.topic', () => {});

      expect(bus.getSubscriberCount('test.topic')).toBe(2);
    });

    it('should clear all subscriptions', () => {
      bus.subscribe('test.1', () => {});
      bus.subscribe('test.2', () => {});

      bus.clear();

      expect(bus.getSubscriberCount('test.1')).toBe(0);
      expect(bus.getSubscriberCount('test.2')).toBe(0);
    });
  });

  describe('performance', () => {
    it('should handle high message throughput', async () => {
      let count = 0;

      bus.subscribe('perf.test', () => {
        count++;
      });

      const start = performance.now();

      for (let i = 0; i < 1000; i++) {
        await bus.publish('perf.test', { i });
      }

      const elapsed = performance.now() - start;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(1000); // Should process 1000 msgs in < 1 second
    });
  });
});
