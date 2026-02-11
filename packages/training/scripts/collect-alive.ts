#!/usr/bin/env npx tsx
/**
 * Collect more ALIVE tokens to balance training data
 */

import { appendFileSync, existsSync, readFileSync } from 'fs';

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';
const OUTPUT_FILE = './data/training-extremes.jsonl';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function rateLimitedFetch(url: string): Promise<any> {
  await sleep(350);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Load existing tokens
function loadExisting(): Set<string> {
  const existing = new Set<string>();
  const files = ['./data/training-large.jsonl', './data/training-extremes.jsonl'];

  for (const file of files) {
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
        try { existing.add(JSON.parse(line).tokenAddress); } catch {}
      }
    }
  }
  console.log(`Loaded ${existing.size} existing tokens`);
  return existing;
}

async function main() {
  const existing = loadExisting();
  const results: any[] = [];

  // Known good Solana projects with active trading
  const aliveQueries = [
    'render', 'hnt', 'orca', 'marinade', 'drift', 'kamino',
    'parcl', 'nosana', 'sanctum', 'foxy', 'samo', 'bome',
    'slerf', 'wen', 'myro', 'smog', 'ponke', 'mew', 'jito',
    'helium', 'hivemapper', 'helios', 'grass', 'phantom'
  ];

  console.log('\nSearching for ALIVE tokens...\n');

  for (const q of aliveQueries) {
    try {
      const data = await rateLimitedFetch(`${DEXSCREENER_API}/search?q=${q}`);
      if (!data.pairs) continue;

      const alive = data.pairs.filter((p: any) => {
        if (p.chainId !== 'solana') return false;
        if (existing.has(p.baseToken?.address)) return false;
        const liq = p.liquidity?.usd || 0;
        const vol = p.volume?.h24 || 0;
        const age = (Date.now() - (p.pairCreatedAt || Date.now())) / 3600000;
        return liq > 20000 && vol > 5000 && age > 48;
      });

      for (const pair of alive.slice(0, 3)) {
        const addr = pair.baseToken?.address;
        if (!addr || existing.has(addr)) continue;

        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h24 || 0;
        const age = (Date.now() - (pair.pairCreatedAt || Date.now())) / 3600000;

        results.push({
          tokenAddress: addr,
          symbol: pair.baseToken?.symbol || 'UNK',
          features: {
            liquidity: liq,
            volume24h: vol,
            marketCap: pair.marketCap || 0,
            ageHours: age
          },
          label: 'ALIVE',
          collectedAt: Date.now()
        });
        existing.add(addr);
        console.log(`  ✓ ALIVE: ${pair.baseToken?.symbol} - $${liq.toLocaleString()} liq, ${Math.round(age)}h old`);
      }
    } catch (e) {
      console.error(`Error searching ${q}:`, (e as Error).message);
    }
  }

  // Save
  for (const r of results) {
    appendFileSync(OUTPUT_FILE, JSON.stringify(r) + '\n');
  }

  console.log(`\nCollected ${results.length} ALIVE tokens`);
}

main().catch(console.error);
