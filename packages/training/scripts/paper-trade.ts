#!/usr/bin/env npx tsx
/**
 * ARGUS AI - Paper Trading (Live Simulation)
 *
 * Real-time paper trading with:
 * - Immediate entries when filters pass
 * - Price monitoring every 15 seconds
 * - Stop-loss, take-profit, rug detection exits
 * - Live P&L tracking
 */

import 'dotenv/config';
import { writeFileSync, readFileSync, existsSync } from 'fs';

const DEXSCREENER_API = 'https://api.dexscreener.com';
const POSITIONS_FILE = './data/paper-positions.json';
const TRADES_FILE = './data/paper-trades.jsonl';

// Trading config
const CONFIG = {
  BASE_POSITION: 0.1,        // SOL per trade
  STOP_LOSS: -15,            // Exit at -15%
  TAKE_PROFIT: 50,           // Start trailing at +50%
  TRAILING_FLOOR: 30,        // Don't give back below +30% if hit TP
  MAX_POSITIONS: 5,          // Max concurrent positions
  MONITOR_INTERVAL: 15000,   // Check prices every 15 sec
  ENTRY_COOLDOWN: 60000,     // 1 min between entries
  // Filters
  MIN_LIQUIDITY: 15000,
  MIN_AGE_HOURS: 0.25,       // 15 min
  MAX_SCORE: 60,
  MIN_VOL_RATIO: 0.25,
  MAX_VOLUME: 150000,
};

interface Position {
  tokenAddress: string;
  symbol: string;
  entryPrice: number;
  entryTime: number;
  size: number;           // SOL
  highPrice: number;      // Track peak for trailing stop
  currentPrice: number;
  pnlPercent: number;
  hitTakeProfit: boolean; // Trailing stop active
}

interface Trade {
  tokenAddress: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  pnlPercent?: number;
  pnlSol?: number;
  reason?: string;        // 'entry' | 'stop-loss' | 'take-profit' | 'rug' | 'trailing'
  timestamp: number;
}

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h24: number };
  priceChange?: { m5?: number; h1?: number };
  txns?: { m5?: { buys: number; sells: number } };
  pairCreatedAt?: number;
}

// State
let positions: Position[] = [];
let totalPnl = 0;
let totalTrades = 0;
let wins = 0;
let losses = 0;
let lastEntryTime = 0;
const seenTokens = new Set<string>();

// Simple prediction (same as dry-run)
function predict(pair: DexPair): number {
  const liquidity = pair.liquidity?.usd || 0;
  const priceChange = pair.priceChange?.h1 || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;

  let score = 30;
  if (liquidity === 0) return 100;
  if (liquidity < 1000) score += 40;
  else if (liquidity < 5000) score += 25;
  else if (liquidity < 10000) score += 15;
  if (ageHours < 1) score += 20;
  else if (ageHours < 6) score += 10;
  if (priceChange < -80) score += 30;
  else if (priceChange < -50) score += 20;
  else if (priceChange < -30) score += 10;

  return Math.min(100, score);
}

// Check if token passes filters
function passesFilters(pair: DexPair): { passes: boolean; reason?: string } {
  const score = predict(pair);
  const liq = pair.liquidity?.usd || 0;
  const vol = pair.volume?.h24 || 0;
  const ageMs = pair.pairCreatedAt ? Date.now() - pair.pairCreatedAt : 0;
  const ageHours = ageMs / 3600000;
  const pc5m = pair.priceChange?.m5 || 0;
  const pc1h = pair.priceChange?.h1 || 0;
  const buys = pair.txns?.m5?.buys || 0;
  const sells = pair.txns?.m5?.sells || 0;

  if (score >= CONFIG.MAX_SCORE) return { passes: false, reason: 'score' };
  if (liq < CONFIG.MIN_LIQUIDITY) return { passes: false, reason: 'liquidity' };
  if (ageHours < CONFIG.MIN_AGE_HOURS) return { passes: false, reason: 'age' };
  if (vol < liq * CONFIG.MIN_VOL_RATIO) return { passes: false, reason: 'volume-low' };
  if (vol > CONFIG.MAX_VOLUME) return { passes: false, reason: 'volume-high' };
  if (pc5m > 100) return { passes: false, reason: 'pump' };

  const hasMomentum = pc5m > 0 || (pc1h > 0 && buys > sells);
  if (!hasMomentum) return { passes: false, reason: 'momentum' };

  return { passes: true };
}

// Fetch token data
async function fetchToken(address: string): Promise<DexPair | null> {
  try {
    const response = await fetch(`${DEXSCREENER_API}/latest/dex/tokens/${address}`);
    if (!response.ok) return null;
    const data = await response.json() as { pairs?: DexPair[] };
    return data.pairs?.find(p => p.chainId === 'solana') || null;
  } catch {
    return null;
  }
}

// Fetch latest tokens
async function fetchLatestTokens(): Promise<DexPair[]> {
  const pairs: DexPair[] = [];

  try {
    const response = await fetch(`${DEXSCREENER_API}/token-boosts/top/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 15);
      for (const t of solanaTokens) {
        const pair = await fetchToken(t.tokenAddress);
        if (pair) pairs.push(pair);
        await new Promise(r => setTimeout(r, 50));
      }
    }
  } catch {}

  try {
    const response = await fetch(`${DEXSCREENER_API}/token-profiles/latest/v1`);
    if (response.ok) {
      const data = await response.json() as Array<{ chainId: string; tokenAddress: string }>;
      const solanaTokens = data.filter(t => t.chainId === 'solana').slice(0, 15);
      for (const t of solanaTokens) {
        if (!pairs.find(p => p.baseToken.address === t.tokenAddress)) {
          const pair = await fetchToken(t.tokenAddress);
          if (pair) pairs.push(pair);
          await new Promise(r => setTimeout(r, 50));
        }
      }
    }
  } catch {}

  return pairs;
}

// Log trade
function logTrade(trade: Trade): void {
  const line = JSON.stringify(trade) + '\n';
  writeFileSync(TRADES_FILE, line, { flag: 'a' });
}

// Save positions
function savePositions(): void {
  writeFileSync(POSITIONS_FILE, JSON.stringify({ positions, totalPnl, totalTrades, wins, losses }, null, 2));
}

// Load positions
function loadPositions(): void {
  if (existsSync(POSITIONS_FILE)) {
    const data = JSON.parse(readFileSync(POSITIONS_FILE, 'utf-8'));
    positions = data.positions || [];
    totalPnl = data.totalPnl || 0;
    totalTrades = data.totalTrades || 0;
    wins = data.wins || 0;
    losses = data.losses || 0;
  }
}

// Enter position
function enterPosition(pair: DexPair): void {
  const price = parseFloat(pair.priceUsd) || 0;
  if (price === 0) return;

  const score = predict(pair);
  const size = score >= 40 ? CONFIG.BASE_POSITION * 0.5 : CONFIG.BASE_POSITION;

  const position: Position = {
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    entryPrice: price,
    entryTime: Date.now(),
    size,
    highPrice: price,
    currentPrice: price,
    pnlPercent: 0,
    hitTakeProfit: false,
  };

  positions.push(position);
  lastEntryTime = Date.now();

  logTrade({
    tokenAddress: pair.baseToken.address,
    symbol: pair.baseToken.symbol,
    side: 'BUY',
    price,
    size,
    reason: 'entry',
    timestamp: Date.now(),
  });

  console.log(`  \x1b[32m>>> BUY ${pair.baseToken.symbol}\x1b[0m @ $${price.toFixed(8)} | ${size} SOL | Score: ${score}`);
  savePositions();
}

// Exit position
function exitPosition(position: Position, reason: string, currentPrice: number): void {
  const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const pnlSol = position.size * (pnlPercent / 100);

  totalPnl += pnlSol;
  totalTrades++;
  if (pnlSol >= 0) wins++;
  else losses++;

  logTrade({
    tokenAddress: position.tokenAddress,
    symbol: position.symbol,
    side: 'SELL',
    price: currentPrice,
    size: position.size,
    pnlPercent,
    pnlSol,
    reason,
    timestamp: Date.now(),
  });

  const color = pnlSol >= 0 ? '\x1b[32m' : '\x1b[31m';
  const sign = pnlSol >= 0 ? '+' : '';
  console.log(`  ${color}<<< SELL ${position.symbol}\x1b[0m @ $${currentPrice.toFixed(8)} | ${reason} | ${sign}${pnlPercent.toFixed(1)}% | ${sign}${pnlSol.toFixed(4)} SOL`);

  positions = positions.filter(p => p.tokenAddress !== position.tokenAddress);
  savePositions();
}

// Monitor positions
async function monitorPositions(): Promise<void> {
  for (const position of [...positions]) {
    const pair = await fetchToken(position.tokenAddress);

    if (!pair) {
      // Token not found = rug
      exitPosition(position, 'RUG', 0);
      continue;
    }

    const currentPrice = parseFloat(pair.priceUsd) || 0;
    const liquidity = pair.liquidity?.usd || 0;

    // Rug detection
    if (liquidity < 500 || currentPrice === 0) {
      exitPosition(position, 'RUG', currentPrice);
      continue;
    }

    position.currentPrice = currentPrice;
    position.pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    // Update high price
    if (currentPrice > position.highPrice) {
      position.highPrice = currentPrice;
    }

    // Check take profit hit
    if (position.pnlPercent >= CONFIG.TAKE_PROFIT) {
      position.hitTakeProfit = true;
    }

    // Stop loss
    if (position.pnlPercent <= CONFIG.STOP_LOSS) {
      exitPosition(position, 'STOP-LOSS', currentPrice);
      continue;
    }

    // Trailing stop (if hit TP and now dropping below floor)
    if (position.hitTakeProfit && position.pnlPercent <= CONFIG.TRAILING_FLOOR) {
      exitPosition(position, 'TRAILING', currentPrice);
      continue;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  savePositions();
}

// Display status
function displayStatus(): void {
  console.log('');
  console.log('─'.repeat(60));
  console.log(`  Positions: ${positions.length}/${CONFIG.MAX_POSITIONS} | Trades: ${totalTrades} | Win Rate: ${totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(0) : 0}%`);
  console.log(`  \x1b[1mTotal P&L: ${totalPnl >= 0 ? '\x1b[32m+' : '\x1b[31m'}${totalPnl.toFixed(4)} SOL\x1b[0m`);

  if (positions.length > 0) {
    console.log('');
    console.log('  Open Positions:');
    for (const p of positions) {
      const holdMin = ((Date.now() - p.entryTime) / 60000).toFixed(0);
      const color = p.pnlPercent >= 0 ? '\x1b[32m' : '\x1b[31m';
      const sign = p.pnlPercent >= 0 ? '+' : '';
      const tp = p.hitTakeProfit ? ' [TP]' : '';
      console.log(`    ${p.symbol.padEnd(12)} ${color}${sign}${p.pnlPercent.toFixed(1)}%\x1b[0m | ${holdMin}m${tp}`);
    }
  }
  console.log('─'.repeat(60));
}

// Main loop
async function main(): Promise<void> {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ARGUS AI - Paper Trading (LIVE SIMULATION)               ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Config: ${CONFIG.BASE_POSITION} SOL | SL: ${CONFIG.STOP_LOSS}% | TP: ${CONFIG.TAKE_PROFIT}%`);
  console.log(`  Filters: liq >= $${CONFIG.MIN_LIQUIDITY/1000}K | age >= ${CONFIG.MIN_AGE_HOURS * 60}m | score < ${CONFIG.MAX_SCORE}`);
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('');

  loadPositions();

  // Load seen tokens from existing positions
  positions.forEach(p => seenTokens.add(p.tokenAddress));

  let cycle = 0;

  while (true) {
    cycle++;
    const now = new Date().toLocaleTimeString();

    // Monitor existing positions
    if (positions.length > 0) {
      await monitorPositions();
    }

    // Look for new entries every 4th cycle (1 min) if we have room
    if (cycle % 4 === 1 && positions.length < CONFIG.MAX_POSITIONS) {
      const timeSinceLastEntry = Date.now() - lastEntryTime;
      if (timeSinceLastEntry >= CONFIG.ENTRY_COOLDOWN) {
        console.log(`\n[${now}] Scanning for entries...`);
        const tokens = await fetchLatestTokens();

        for (const pair of tokens) {
          if (seenTokens.has(pair.baseToken.address)) continue;
          if (positions.length >= CONFIG.MAX_POSITIONS) break;

          seenTokens.add(pair.baseToken.address);
          const { passes } = passesFilters(pair);

          if (passes) {
            enterPosition(pair);
          }
        }
      }
    }

    // Display status every cycle
    if (cycle % 4 === 0 || positions.length > 0) {
      displayStatus();
    }

    // Wait before next check
    await new Promise(r => setTimeout(r, CONFIG.MONITOR_INTERVAL));
  }
}

main().catch(console.error);
