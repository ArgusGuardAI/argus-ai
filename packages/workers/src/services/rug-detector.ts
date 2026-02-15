/**
 * Rug Detection Service - Pure On-Chain
 *
 * Detects rugs using only Solana RPC data:
 * - Pool reserves (SOL drained = rug)
 * - LP token burns
 * - No external APIs
 *
 * Zero dependencies. Zero costs. Complete independence.
 */

import { SolanaRpcClient } from './solana-rpc';
import { getPrimaryPool } from './dex-pools';
import { markTokenAsRugged } from './bundle-network';

interface RugCheckResult {
  tokenAddress: string;
  symbol: string;
  isRugged: boolean;
  reason?: string;
  poolData?: {
    quoteReserve: number;
    tokenReserve: number;
    lpLockedPct: number;
  };
}

/**
 * Check if a token has rugged using on-chain pool data
 */
async function checkTokenOnChain(
  rpc: SolanaRpcClient,
  tokenAddress: string,
  symbol: string
): Promise<RugCheckResult> {
  try {
    // Get pool data directly from chain
    const pool = await getPrimaryPool(rpc, tokenAddress);

    if (!pool) {
      // No pool found - could be rugged or just no liquidity
      console.log(`[RugDetector] No pool found for ${symbol || tokenAddress.slice(0, 8)}`);
      return {
        tokenAddress,
        symbol,
        isRugged: true,
        reason: 'No liquidity pool found on-chain',
      };
    }

    // Rug detection criteria (all on-chain):
    // 1. SOL reserve < 0.1 SOL (liquidity pulled)
    // 2. Token reserve near max (dev dumped all tokens)
    // 3. LP not locked and reserves drained

    const quoteReserve = pool.quoteReserve; // SOL amount
    const tokenReserve = pool.tokenReserve;
    const lpLockedPct = pool.lpLockedPct;

    const isRugged = (
      // Liquidity pulled - less than 0.1 SOL
      quoteReserve < 0.1 ||
      // Or very low liquidity with unlocked LP
      (quoteReserve < 1 && lpLockedPct < 50)
    );

    let reason: string | undefined;
    if (isRugged) {
      if (quoteReserve < 0.1) {
        reason = `Liquidity drained (${quoteReserve.toFixed(4)} SOL remaining)`;
      } else {
        reason = `Low liquidity (${quoteReserve.toFixed(2)} SOL) with unlocked LP (${lpLockedPct}%)`;
      }
    }

    return {
      tokenAddress,
      symbol,
      isRugged,
      reason,
      poolData: {
        quoteReserve,
        tokenReserve,
        lpLockedPct,
      },
    };
  } catch (error) {
    console.error(`[RugDetector] Error checking ${symbol || tokenAddress.slice(0, 8)}:`, error);
    return {
      tokenAddress,
      symbol,
      isRugged: false, // Don't mark as rugged on error
    };
  }
}

/**
 * Run rug detection on all tracked tokens
 * Uses pure on-chain data via RPC
 */
export async function runRugDetection(
  db: D1Database,
  rpcUrl?: string
): Promise<{
  checked: number;
  rugged: number;
  errors: number;
}> {
  const stats = { checked: 0, rugged: 0, errors: 0 };

  // Initialize RPC client
  const rpc = new SolanaRpcClient(rpcUrl);

  try {
    // Get unique tokens that haven't been marked as rugged yet
    // Only check tokens from the last 14 days (rugs happen fast)
    const fourteenDaysAgo = Math.floor(Date.now() / 1000) - (14 * 24 * 60 * 60);

    const tokensResult = await db.prepare(`
      SELECT DISTINCT token_address, token_symbol
      FROM bundle_wallet_tokens
      WHERE rugged = 0 AND detected_at > ?
      ORDER BY detected_at DESC
      LIMIT 50
    `).bind(fourteenDaysAgo).all<{ token_address: string; token_symbol: string | null }>();

    const tokens = tokensResult.results || [];
    console.log(`[RugDetector] Checking ${tokens.length} tokens via on-chain RPC...`);

    // Check each token
    for (const token of tokens) {
      try {
        const result = await checkTokenOnChain(
          rpc,
          token.token_address,
          token.token_symbol || '?'
        );
        stats.checked++;

        if (result.isRugged) {
          console.log(`[RugDetector] RUG: ${token.token_symbol || token.token_address.slice(0, 8)} - ${result.reason}`);
          await markTokenAsRugged(db, token.token_address);
          stats.rugged++;
        } else if (result.poolData) {
          console.log(`[RugDetector] OK: ${token.token_symbol} - ${result.poolData.quoteReserve.toFixed(2)} SOL, ${result.poolData.lpLockedPct}% locked`);
        }

        // Small delay to avoid RPC rate limits
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`[RugDetector] Error: ${token.token_address.slice(0, 8)}:`, error);
        stats.errors++;
      }
    }

    console.log(`[RugDetector] Complete: ${stats.checked} checked, ${stats.rugged} rugged, ${stats.errors} errors`);
  } catch (error) {
    console.error('[RugDetector] Fatal error:', error);
  }

  return stats;
}

/**
 * Check a single token for rug status
 * Can be called on-demand
 */
export async function checkSingleToken(
  rpcUrl: string | undefined,
  tokenAddress: string,
  symbol: string = '?'
): Promise<RugCheckResult> {
  const rpc = new SolanaRpcClient(rpcUrl);
  return checkTokenOnChain(rpc, tokenAddress, symbol);
}
