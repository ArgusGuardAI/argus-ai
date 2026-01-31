/**
 * MessageBus - Inter-Agent Communication System
 *
 * Enables agents to communicate with each other through
 * publish/subscribe messaging patterns.
 */

import { EventEmitter } from 'events';

export interface Message {
  id: string;
  topic: string;
  from: string;
  to?: string;
  data: any;
  timestamp: number;
  priority: 'low' | 'normal' | 'high' | 'critical';
}

export interface MessageHandler {
  (message: Message): Promise<void> | void;
}

export class MessageBus extends EventEmitter {
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private messageHistory: Message[] = [];
  private maxHistory: number = 1000;

  constructor() {
    super();
    this.setMaxListeners(100); // Support many agents
  }

  /**
   * Publish message to a topic
   */
  async publish(topic: string, data: any, options: {
    from?: string;
    to?: string;
    priority?: Message['priority'];
  } = {}): Promise<void> {
    const message: Message = {
      id: this.generateId(),
      topic,
      from: options.from || 'system',
      to: options.to,
      data,
      timestamp: Date.now(),
      priority: options.priority || 'normal'
    };

    // Store in history
    this.messageHistory.push(message);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }

    // Emit to exact topic subscribers
    this.emit(topic, message);

    // Emit to wildcard subscribers (e.g., 'agent.*' matches 'agent.scout-1')
    const topicParts = topic.split('.');
    for (let i = topicParts.length; i > 0; i--) {
      const wildcardTopic = topicParts.slice(0, i).join('.') + '.*';
      this.emit(wildcardTopic, message);
    }

    // Emit to global listeners
    this.emit('*', message);
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string, handler: MessageHandler): () => void {
    this.on(topic, handler);

    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Set());
    }
    this.subscribers.get(topic)!.add(handler);

    // Return unsubscribe function
    return () => this.unsubscribe(topic, handler);
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string, handler: MessageHandler): void {
    this.off(topic, handler);
    this.subscribers.get(topic)?.delete(handler);
  }

  /**
   * Send direct message to specific agent
   */
  async sendTo(agentName: string, type: string, data: any, from: string): Promise<void> {
    await this.publish(`agent.${agentName}.${type}`, data, {
      from,
      to: agentName,
      priority: 'normal'
    });
  }

  /**
   * Broadcast alert to all agents
   */
  async broadcastAlert(alertType: string, data: any, from: string): Promise<void> {
    await this.publish(`alert.${alertType}`, data, {
      from,
      priority: 'critical'
    });
  }

  /**
   * Get message history for debugging
   */
  getHistory(limit: number = 100): Message[] {
    return this.messageHistory.slice(-limit);
  }

  /**
   * Get subscriber count for topic
   */
  getSubscriberCount(topic: string): number {
    return this.subscribers.get(topic)?.size || 0;
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.removeAllListeners();
    this.subscribers.clear();
    this.messageHistory = [];
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance for the network
export const globalMessageBus = new MessageBus();
