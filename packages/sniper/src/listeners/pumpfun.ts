/**
 * Pump.fun Bonding Curve Listener
 * Detects NEW tokens the moment they're created on pump.fun
 * These are pre-graduation tokens still on the bonding curve
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { NewTokenEvent } from '../types';

// Pump.fun WebSocket endpoint
const PUMPFUN_WS = 'wss://pumpportal.fun/api/data';

export class PumpfunListener extends EventEmitter {
  private ws: WebSocket | null = null;
  private isRunning: boolean = false;
  private seenTokens: Set<string> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Start listening for new pump.fun tokens
   */
  async start() {
    if (this.isRunning) {
      console.log('[Pumpfun] Already running');
      return;
    }

    console.log('[Pumpfun] Starting bonding curve listener...');
    this.isRunning = true;
    this.connect();
  }

  /**
   * Connect to pump.fun WebSocket
   */
  private connect() {
    console.log('[Pumpfun] Connecting to WebSocket...');

    this.ws = new WebSocket(PUMPFUN_WS);

    this.ws.on('open', () => {
      console.log('[Pumpfun] WebSocket connected');

      // Subscribe to new token creations
      const subscribeMsg = {
        method: 'subscribeNewToken',
      };
      this.ws?.send(JSON.stringify(subscribeMsg));
      console.log('[Pumpfun] Subscribed to new tokens');

      // Keep connection alive
      this.pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.ping();
        }
      }, 30000);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        // Ignore parse errors
      }
    });

    this.ws.on('error', (error) => {
      console.error('[Pumpfun] WebSocket error:', error.message);
    });

    this.ws.on('close', () => {
      console.log('[Pumpfun] WebSocket closed');
      this.cleanup();

      if (this.isRunning) {
        console.log('[Pumpfun] Reconnecting in 5 seconds...');
        this.reconnectTimeout = setTimeout(() => this.connect(), 5000);
      }
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: any) {
    // New token creation event
    if (message.txType === 'create' || message.mint) {
      this.processNewToken(message);
    }
  }

  /**
   * Process a new token creation
   */
  private processNewToken(data: any) {
    const tokenAddress = data.mint;
    if (!tokenAddress) return;

    // Skip if already seen
    if (this.seenTokens.has(tokenAddress)) return;
    this.seenTokens.add(tokenAddress);

    // Keep cache from growing too large
    if (this.seenTokens.size > 5000) {
      const arr = Array.from(this.seenTokens);
      this.seenTokens = new Set(arr.slice(-2500));
    }

    const name = data.name || 'Unknown';
    const symbol = data.symbol || '???';
    const creator = data.traderPublicKey || data.creator || 'unknown';

    // Bonding curve tokens start with 0 liquidity (it builds up)
    // Market cap starts at ~$5-6K
    const initialMarketCap = data.marketCapSol ? data.marketCapSol * 200 : 5000; // Estimate
    const bondingProgress = data.vSolInBondingCurve || 0;

    console.log(`[Pumpfun] 🆕 NEW TOKEN: ${symbol} (${tokenAddress.slice(0, 8)}...)`);
    console.log(`[Pumpfun]    Creator: ${creator.slice(0, 8)}...`);
    console.log(`[Pumpfun]    Bonding: ${bondingProgress.toFixed(2)} SOL`);

    const token: NewTokenEvent = {
      address: tokenAddress,
      name,
      symbol,
      decimals: 6, // Pump.fun tokens use 6 decimals
      source: 'pumpfun' as any, // Bonding curve stage
      creator,
      liquidityUsd: bondingProgress * 200, // Estimate based on SOL price
      timestamp: Date.now(),
      initialMarketCap,
      // Extra pump.fun specific data
      metadata: {
        stage: 'bonding_curve',
        bondingProgress,
        devBuy: data.initialBuy || 0,
        uri: data.uri || null,
      },
    };

    this.emit('newToken', token);
  }

  /**
   * Stop listening
   */
  stop() {
    console.log('[Pumpfun] Stopping...');
    this.isRunning = false;
    this.cleanup();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    console.log('[Pumpfun] Stopped');
  }

  /**
   * Cleanup timers
   */
  private cleanup() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      tokensDetected: this.seenTokens.size,
      connected: this.ws?.readyState === WebSocket.OPEN,
    };
  }
}
