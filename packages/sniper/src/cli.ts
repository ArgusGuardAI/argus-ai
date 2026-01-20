#!/usr/bin/env tsx
/**
 * ArgusGuard Sniper CLI
 * Quick way to test the sniper engine
 *
 * Usage:
 *   WALLET_PRIVATE_KEY=... pnpm cli
 *
 * Or for watch-only mode (no trading):
 *   pnpm cli --watch-only
 */

import { SniperEngine } from './engine/sniper';

const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.mainnet-beta.solana.com';
const WALLET_KEY = process.env.WALLET_PRIVATE_KEY || '';
const WATCH_ONLY = process.argv.includes('--watch-only');

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║         ArgusGuard Smart Sniper v0.1.0            ║');
  console.log('║   AI-powered safe token sniping on Solana         ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');

  if (WATCH_ONLY) {
    console.log('🔍 WATCH-ONLY MODE - No trades will be executed');
    console.log('');
  }

  const sniper = new SniperEngine(RPC_URL, {
    walletPrivateKey: WATCH_ONLY ? 'watch-only' : WALLET_KEY,
    buyAmountSol: 0.05, // Small amount for testing
    maxRiskScore: 40, // Only snipe if ArgusGuard score < 40
    minLiquidityUsd: 500,
    allowPumpFun: true,
    allowRaydium: false, // Start with just pump.fun
    takeProfitPercent: 50, // Sell at 1.5x
    stopLossPercent: 25, // Sell if down 25%
  });

  // Listen for events
  sniper.on('message', (msg: any) => {
    switch (msg.type) {
      case 'NEW_TOKEN':
        console.log(`\n🆕 New token: ${msg.data.symbol} (${msg.data.address})`);
        console.log(`   Source: ${msg.data.source} | Creator: ${msg.data.creator.slice(0, 8)}...`);
        break;

      case 'ANALYSIS_RESULT':
        const decision = msg.data;
        if (decision.shouldBuy) {
          console.log(`   ✅ SAFE (score: ${decision.riskScore}) - ${decision.reason}`);
        } else {
          console.log(`   ❌ SKIP (score: ${decision.riskScore}) - ${decision.reason}`);
        }
        break;

      case 'SNIPE_ATTEMPT':
        if (msg.data.status === 'pending') {
          console.log(`   🎯 Attempting snipe...`);
        } else if (msg.data.status === 'success') {
          console.log(`   💰 SNIPED! TX: ${msg.data.txSignature}`);
        } else {
          console.log(`   ❌ Snipe failed`);
        }
        break;

      case 'STATUS_UPDATE':
        // Periodic status update
        break;
    }
  });

  sniper.on('error', (err: Error) => {
    console.error('❌ Error:', err.message);
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    sniper.stop();
    const state = sniper.getState();
    console.log(`\nSession stats:`);
    console.log(`  Tokens scanned: ${state.tokensScanned}`);
    console.log(`  Tokens sniped: ${state.tokensSniped}`);
    console.log(`  Tokens skipped: ${state.tokensSkipped}`);
    console.log(`  Total PnL: ${state.totalPnlSol.toFixed(4)} SOL`);
    process.exit(0);
  });

  // Start in watch-only or live mode
  if (WATCH_ONLY) {
    // In watch-only, just listen without executing trades
    const { PumpFunListener } = await import('./listeners/pump-fun');
    const { TokenAnalyzer } = await import('./engine/analyzer');

    const listener = new PumpFunListener();
    const analyzer = new TokenAnalyzer({
      walletPrivateKey: '',
      buyAmountSol: 0,
      maxSlippageBps: 0,
      priorityFeeLamports: 0,
      useJito: false,
      maxRiskScore: 40,
      minLiquidityUsd: 500,
      allowPumpFun: true,
      allowRaydium: false,
      blacklistCreators: [],
      takeProfitPercent: 0,
      stopLossPercent: 0,
      maxHoldTimeMinutes: 0,
    });

    listener.on('newToken', async (token) => {
      console.log(`\n🆕 New token: ${token.symbol} (${token.address})`);
      console.log(`   Source: ${token.source} | Creator: ${token.creator.slice(0, 8)}...`);

      const decision = await analyzer.analyze(token);
      if (decision.shouldBuy) {
        console.log(`   ✅ WOULD SNIPE (score: ${decision.riskScore})`);
      } else {
        console.log(`   ❌ SKIP (score: ${decision.riskScore}) - ${decision.reason}`);
      }
    });

    console.log('Connecting to pump.fun...\n');
    listener.start();
  } else {
    if (!WALLET_KEY) {
      console.error('❌ WALLET_PRIVATE_KEY environment variable required for live trading');
      console.log('   Run with --watch-only to test without a wallet');
      process.exit(1);
    }

    console.log('Starting sniper engine...\n');
    await sniper.start();
  }

  console.log('Listening for new tokens... (Ctrl+C to stop)\n');
}

main().catch(console.error);
