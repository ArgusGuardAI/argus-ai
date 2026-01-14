/**
 * Pump.fun Token Listener
 * Monitors for new token launches on pump.fun
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { NewTokenEvent } from '../types';

const PUMP_FUN_WS = 'wss://pumpportal.fun/api/data';

export class PumpFunListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private isRunning = false;

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.connect();
  }

  stop() {
    this.isRunning = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect() {
    if (!this.isRunning) return;

    console.log('[PumpFun] Connecting to WebSocket...');

    this.ws = new WebSocket(PUMP_FUN_WS);

    this.ws.on('open', () => {
      console.log('[PumpFun] Connected!');
      this.reconnectAttempts = 0;

      // Subscribe to new token events
      this.ws?.send(JSON.stringify({
        method: 'subscribeNewToken',
      }));
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (err) {
        console.error('[PumpFun] Failed to parse message:', err);
      }
    });

    this.ws.on('close', () => {
      console.log('[PumpFun] Disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[PumpFun] WebSocket error:', err);
    });
  }

  private handleMessage(message: any) {
    // New token creation event
    if (message.txType === 'create' || message.mint) {
      const tokenEvent: NewTokenEvent = {
        address: message.mint,
        name: message.name || 'Unknown',
        symbol: message.symbol || '???',
        source: 'pump.fun',
        creator: message.traderPublicKey || message.creator || '',
        liquidityUsd: message.marketCapSol ? message.marketCapSol * 150 : 0, // Estimate
        timestamp: Date.now(),
      };

      console.log(`[PumpFun] New token: ${tokenEvent.symbol} (${tokenEvent.address})`);
      this.emit('newToken', tokenEvent);
    }
  }

  private scheduleReconnect() {
    if (!this.isRunning) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PumpFun] Max reconnect attempts reached');
      this.emit('error', new Error('Max reconnect attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`[PumpFun] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})`);

    setTimeout(() => this.connect(), delay);
  }
}
