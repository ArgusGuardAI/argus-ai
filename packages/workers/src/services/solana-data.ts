/**
 * Solana Data Service
 * Fetches on-chain data for comprehensive token analysis
 */

const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

function getHeliusRpcUrl(apiKey: string): string {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

export interface TokenOnChainData {
  // Token metadata
  tokenAddress: string;
  tokenName?: string;
  tokenSymbol?: string;
  decimals: number;
  totalSupply: number;

  // Holder analysis
  totalHolders: number;
  topHolders: HolderInfo[];
  top10HolderPercent: number;
  top1HolderPercent: number;

  // Non-LP holder analysis (excludes liquidity pools/bonding curves)
  top1NonLpHolderPercent: number;
  top10NonLpHolderPercent: number;

  // Liquidity info
  liquidityPools: LiquidityPool[];
  totalLiquidityUsd: number;
  lpLocked: boolean;
  lpLockDuration?: number;

  // Deployer info
  deployerAddress: string;
  deployerAge: number; // days since first tx
  deployerTokenCount: number;
  deployerPreviousRugs: number;

  // Bundle detection
  bundleDetected: boolean;
  bundleInfo?: BundleInfo;

  // Trading patterns
  buyCount24h: number;
  sellCount24h: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;
}

export interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
  isDeployer: boolean;
  isLiquidityPool: boolean;
}

export interface LiquidityPool {
  address: string;
  dex: string;
  liquidityUsd: number;
  tokenReserve: number;
  solReserve: number;
}

export interface BundleInfo {
  bundleCount: number;
  totalWalletsInBundles: number;
  bundledBuyPercent: number;
  suspiciousPatterns: string[];
}

/**
 * Fetch comprehensive on-chain data for a token
 */
export async function fetchTokenData(
  tokenAddress: string,
  heliusApiKey?: string,
  knownLpAddresses?: string[]
): Promise<TokenOnChainData> {
  const rpcUrl = heliusApiKey
    ? getHeliusRpcUrl(heliusApiKey)
    : SOLANA_RPC_URL;

  // Fetch token info first to get total supply
  const tokenInfo = await fetchTokenInfo(tokenAddress, rpcUrl);

  // Fetch holders and transactions in parallel, passing total supply for accurate %
  const [
    holders,
    recentTransactions,
  ] = await Promise.all([
    fetchTopHolders(tokenAddress, rpcUrl, tokenInfo.supply, knownLpAddresses),
    fetchRecentTransactions(tokenAddress, rpcUrl),
  ]);

  // Analyze bundle patterns from transactions
  const bundleInfo = detectBundles(recentTransactions);

  // Mark deployer in holders list
  const deployerAddress = tokenInfo.deployer;
  holders.forEach(h => {
    if (h.address === deployerAddress) {
      h.isDeployer = true;
    }
  });

  // Calculate holder concentration (excluding LP/bonding curve addresses for risk assessment)
  const nonLpHolders = holders.filter(h => !h.isLiquidityPool);
  const top10HolderPercent = holders
    .slice(0, 10)
    .reduce((sum, h) => sum + h.percentage, 0);
  const top1HolderPercent = holders[0]?.percentage || 0;

  // Also calculate non-LP holder concentration (more meaningful for risk)
  const top1NonLpPercent = nonLpHolders[0]?.percentage || 0;
  const top10NonLpPercent = nonLpHolders
    .slice(0, 10)
    .reduce((sum, h) => sum + h.percentage, 0);

  // Analyze trading patterns
  const { buyCount24h, sellCount24h, uniqueBuyers24h, uniqueSellers24h } =
    analyzeTradingPatterns(recentTransactions);

  return {
    tokenAddress,
    tokenName: tokenInfo.name,
    tokenSymbol: tokenInfo.symbol,
    decimals: tokenInfo.decimals,
    totalSupply: tokenInfo.supply,

    totalHolders: holders.length,
    topHolders: holders.slice(0, 20),
    top10HolderPercent,
    top1HolderPercent,
    top1NonLpHolderPercent: top1NonLpPercent,
    top10NonLpHolderPercent: top10NonLpPercent,

    liquidityPools: tokenInfo.liquidityPools,
    totalLiquidityUsd: tokenInfo.liquidityPools.reduce((sum, lp) => sum + lp.liquidityUsd, 0),
    lpLocked: tokenInfo.lpLocked,
    lpLockDuration: tokenInfo.lpLockDuration,

    deployerAddress: tokenInfo.deployer,
    deployerAge: tokenInfo.deployerAge,
    deployerTokenCount: tokenInfo.deployerTokenCount,
    deployerPreviousRugs: tokenInfo.deployerRugCount,

    bundleDetected: bundleInfo.bundleCount > 0,
    bundleInfo: bundleInfo.bundleCount > 0 ? bundleInfo : undefined,

    buyCount24h,
    sellCount24h,
    uniqueBuyers24h,
    uniqueSellers24h,
  };
}

interface TokenInfo {
  name?: string;
  symbol?: string;
  decimals: number;
  supply: number;
  deployer: string;
  deployerAge: number;
  deployerTokenCount: number;
  deployerRugCount: number;
  liquidityPools: LiquidityPool[];
  lpLocked: boolean;
  lpLockDuration?: number;
}

async function fetchTokenInfo(tokenAddress: string, rpcUrl: string): Promise<TokenInfo> {
  try {
    // Fetch token account info
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [
          tokenAddress,
          { encoding: 'jsonParsed' },
        ],
      }),
    });

    const data = await response.json() as {
      result?: {
        value?: {
          data?: {
            parsed?: {
              info?: {
                decimals?: number;
                supply?: string;
                mintAuthority?: string;
              };
            };
          };
        };
      };
    };

    const parsed = data.result?.value?.data?.parsed?.info;

    // Try to get token metadata from Metaplex
    const metadata = await fetchMetaplexMetadata(tokenAddress, rpcUrl);

    return {
      name: metadata?.name,
      symbol: metadata?.symbol,
      decimals: parsed?.decimals || 9,
      supply: parseInt(parsed?.supply || '0') / Math.pow(10, parsed?.decimals || 9),
      deployer: parsed?.mintAuthority || 'unknown',
      deployerAge: 0, // Would need additional RPC calls
      deployerTokenCount: 0,
      deployerRugCount: 0,
      liquidityPools: [],
      lpLocked: false,
    };
  } catch (error) {
    console.error('Error fetching token info:', error);
    return {
      decimals: 9,
      supply: 0,
      deployer: 'unknown',
      deployerAge: 0,
      deployerTokenCount: 0,
      deployerRugCount: 0,
      liquidityPools: [],
      lpLocked: false,
    };
  }
}

async function fetchMetaplexMetadata(
  tokenAddress: string,
  rpcUrl: string
): Promise<{ name?: string; symbol?: string } | null> {
  try {
    // Derive Metaplex metadata PDA
    // This is a simplified version - full implementation would use proper PDA derivation
    const METADATA_PROGRAM = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

    // For now, return null - full implementation would fetch metadata
    return null;
  } catch {
    return null;
  }
}

async function fetchTopHolders(
  tokenAddress: string,
  rpcUrl: string,
  totalSupply?: number,
  knownLpAddresses?: string[]
): Promise<HolderInfo[]> {
  try {
    // Fetch largest token accounts
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenLargestAccounts',
        params: [tokenAddress],
      }),
    });

    const data = await response.json() as {
      result?: {
        value?: Array<{
          address: string;
          amount: string;
          decimals: number;
          uiAmount: number;
        }>;
      };
    };

    const accounts = data.result?.value || [];

    // Use total supply if provided, otherwise fall back to sum of accounts
    // This is critical - we need to know % of TOTAL supply, not just % among top holders
    const denominator = totalSupply && totalSupply > 0
      ? totalSupply
      : accounts.reduce((sum, acc) => sum + (acc.uiAmount || 0), 0);

    // Known LP/AMM program addresses
    const knownLpPrograms = new Set([
      // Raydium AMM
      '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
      // Orca Whirlpool
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    ]);

    // Create a set of known LP wallet addresses for quick lookup
    const knownLpWallets = new Set(knownLpAddresses || []);

    // Fetch owners for accounts that might be LP (top 5)
    const accountsWithOwners = await Promise.all(
      accounts.slice(0, 5).map(async (acc) => {
        // If we have known LP addresses, fetch the owner of this token account
        if (knownLpWallets.size > 0) {
          const owner = await fetchTokenAccountOwner(acc.address, rpcUrl);
          return { ...acc, owner };
        }
        return { ...acc, owner: null };
      })
    );

    // Add remaining accounts without owner lookup
    const remainingAccounts = accounts.slice(5).map(acc => ({ ...acc, owner: null }));
    const allAccounts = [...accountsWithOwners, ...remainingAccounts];

    return allAccounts.map((acc) => {
      // Check if this is a liquidity pool by:
      // 1. Token account address matches known LP programs
      // 2. Token account address contains 'pump' (old heuristic)
      // 3. Owner of this token account is a known LP wallet (bonding curve)
      const isLp = knownLpPrograms.has(acc.address) ||
        acc.address.includes('pump') ||
        Boolean(acc.owner && knownLpWallets.has(acc.owner));

      return {
        address: acc.address,
        balance: acc.uiAmount || 0,
        percentage: denominator > 0 ? ((acc.uiAmount || 0) / denominator) * 100 : 0,
        isDeployer: false, // Will be set by caller if known
        isLiquidityPool: isLp,
      };
    });
  } catch (error) {
    console.error('Error fetching holders:', error);
    return [];
  }
}

/**
 * Fetch the owner of a token account
 */
async function fetchTokenAccountOwner(tokenAccountAddress: string, rpcUrl: string): Promise<string | null> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAccountInfo',
        params: [tokenAccountAddress, { encoding: 'jsonParsed' }],
      }),
    });

    const data = await response.json() as {
      result?: {
        value?: {
          data?: {
            parsed?: {
              info?: {
                owner?: string;
              };
            };
          };
        };
      };
    };

    return data.result?.value?.data?.parsed?.info?.owner || null;
  } catch (error) {
    console.error('Error fetching token account owner:', error);
    return null;
  }
}

interface Transaction {
  signature: string;
  blockTime: number;
  from: string;
  to: string;
  amount: number;
  type: 'buy' | 'sell' | 'transfer';
}

async function fetchRecentTransactions(
  tokenAddress: string,
  rpcUrl: string
): Promise<Transaction[]> {
  try {
    // Fetch recent signatures
    const sigResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignaturesForAddress',
        params: [
          tokenAddress,
          { limit: 100 },
        ],
      }),
    });

    const sigData = await sigResponse.json() as {
      result?: Array<{
        signature: string;
        blockTime?: number;
      }>;
    };

    const signatures = sigData.result || [];

    // For now, return basic structure
    // Full implementation would parse each transaction
    return signatures.map((sig) => ({
      signature: sig.signature,
      blockTime: sig.blockTime || 0,
      from: 'unknown',
      to: 'unknown',
      amount: 0,
      type: 'transfer' as const,
    }));
  } catch (error) {
    console.error('Error fetching transactions:', error);
    return [];
  }
}

/**
 * Detect bundle patterns - coordinated buys from multiple wallets
 * Bundles are a common pump & dump tactic where scammers use many wallets
 * to buy simultaneously to create artificial demand
 */
function detectBundles(transactions: Transaction[]): BundleInfo {
  const suspiciousPatterns: string[] = [];
  let bundleCount = 0;
  let totalWalletsInBundles = 0;
  let bundledBuyPercent = 0;

  // Group transactions by time windows (5 second windows)
  const timeWindows: Map<number, Transaction[]> = new Map();

  for (const tx of transactions) {
    const windowKey = Math.floor(tx.blockTime / 5) * 5;
    const existing = timeWindows.get(windowKey) || [];
    existing.push(tx);
    timeWindows.set(windowKey, existing);
  }

  // Check for suspicious patterns
  for (const [_window, txs] of timeWindows) {
    const buys = txs.filter((tx) => tx.type === 'buy');

    // Multiple buys in same 5-second window is suspicious
    if (buys.length >= 3) {
      bundleCount++;
      totalWalletsInBundles += buys.length;
      suspiciousPatterns.push(
        `${buys.length} coordinated buys detected in same block`
      );
    }
  }

  // Check for wallets that all funded from same source (would need more data)
  // This is a simplified version

  const totalBuys = transactions.filter((tx) => tx.type === 'buy').length;
  if (totalBuys > 0) {
    bundledBuyPercent = (totalWalletsInBundles / totalBuys) * 100;
  }

  if (bundledBuyPercent > 30) {
    suspiciousPatterns.push(`${bundledBuyPercent.toFixed(1)}% of buys appear coordinated`);
  }

  return {
    bundleCount,
    totalWalletsInBundles,
    bundledBuyPercent,
    suspiciousPatterns,
  };
}

function analyzeTradingPatterns(transactions: Transaction[]): {
  buyCount24h: number;
  sellCount24h: number;
  uniqueBuyers24h: number;
  uniqueSellers24h: number;
} {
  const now = Date.now() / 1000;
  const dayAgo = now - 86400;

  const recentTxs = transactions.filter((tx) => tx.blockTime >= dayAgo);

  const buys = recentTxs.filter((tx) => tx.type === 'buy');
  const sells = recentTxs.filter((tx) => tx.type === 'sell');

  return {
    buyCount24h: buys.length,
    sellCount24h: sells.length,
    uniqueBuyers24h: new Set(buys.map((tx) => tx.from)).size,
    uniqueSellers24h: new Set(sells.map((tx) => tx.from)).size,
  };
}

/**
 * Build analysis context string for AI from on-chain data
 */
export function buildOnChainContext(data: TokenOnChainData): string {
  let context = '';

  // Token basics
  context += `TOKEN INFO:\n`;
  context += `- Address: ${data.tokenAddress}\n`;
  if (data.tokenName) context += `- Name: ${data.tokenName}\n`;
  if (data.tokenSymbol) context += `- Symbol: ${data.tokenSymbol}\n`;
  context += `- Total Supply: ${data.totalSupply.toLocaleString()}\n`;
  context += `- Decimals: ${data.decimals}\n\n`;

  // Holder concentration
  context += `HOLDER ANALYSIS (top 20 accounts analyzed):\n`;
  context += `- Top 1 Holder: ${data.top1HolderPercent.toFixed(2)}%\n`;
  context += `- Top 10 Holders: ${data.top10HolderPercent.toFixed(2)}%\n`;

  // Non-LP holder concentration (THIS IS THE REAL RISK INDICATOR)
  context += `\nNON-LP/BONDING CURVE HOLDER CONCENTRATION:\n`;
  context += `- Top 1 Non-LP Holder: ${data.top1NonLpHolderPercent.toFixed(2)}%\n`;
  context += `- Top 10 Non-LP Holders: ${data.top10NonLpHolderPercent.toFixed(2)}%\n`;

  // Risk warnings based on non-LP concentration
  if (data.top1NonLpHolderPercent >= 50) {
    context += `  ⚠️ CRITICAL: Single non-LP wallet controls ${data.top1NonLpHolderPercent.toFixed(1)}% of supply!\n`;
    context += `  This is extremely dangerous - one wallet can crash the price\n`;
  } else if (data.top1NonLpHolderPercent >= 30) {
    context += `  ⚠️ HIGH RISK: Single wallet controls ${data.top1NonLpHolderPercent.toFixed(1)}% of supply\n`;
  } else if (data.top1NonLpHolderPercent >= 20) {
    context += `  ⚠️ MODERATE RISK: Single wallet controls ${data.top1NonLpHolderPercent.toFixed(1)}% of supply\n`;
  }

  if (data.top10NonLpHolderPercent >= 80) {
    context += `  ⚠️ Top 10 non-LP wallets control ${data.top10NonLpHolderPercent.toFixed(1)}% - very concentrated\n`;
  } else if (data.top10NonLpHolderPercent >= 60) {
    context += `  ⚠️ Top 10 non-LP wallets control ${data.top10NonLpHolderPercent.toFixed(1)}% - concentrated\n`;
  }

  if (data.topHolders.length > 0) {
    context += `\n- Top 5 Holders (detailed):\n`;
    data.topHolders.slice(0, 5).forEach((h, i) => {
      context += `  ${i + 1}. ${h.address.slice(0, 8)}... - ${h.percentage.toFixed(2)}%`;
      if (h.isDeployer) context += ' [DEPLOYER - HIGH RISK]';
      if (h.isLiquidityPool) context += ' [LP/BONDING CURVE - OK]';
      context += '\n';
    });
  }
  context += '\n';

  // Liquidity
  context += `LIQUIDITY:\n`;
  context += `- Total Liquidity: $${data.totalLiquidityUsd.toLocaleString()}\n`;
  context += `- LP Locked: ${data.lpLocked ? 'YES' : 'NO'}\n`;
  if (data.lpLockDuration) {
    context += `- Lock Duration: ${data.lpLockDuration} days\n`;
  }
  context += '\n';

  // Deployer
  context += `DEPLOYER INFO:\n`;
  context += `- Address: ${data.deployerAddress}\n`;
  context += `- Wallet Age: ${data.deployerAge} days\n`;
  context += `- Previous Tokens: ${data.deployerTokenCount}\n`;
  context += `- Previous Rugs: ${data.deployerPreviousRugs}\n\n`;

  // Bundle detection
  if (data.bundleDetected && data.bundleInfo) {
    context += `⚠️ BUNDLE DETECTION:\n`;
    context += `- Bundles Detected: ${data.bundleInfo.bundleCount}\n`;
    context += `- Wallets in Bundles: ${data.bundleInfo.totalWalletsInBundles}\n`;
    context += `- Bundled Buy %: ${data.bundleInfo.bundledBuyPercent.toFixed(1)}%\n`;
    if (data.bundleInfo.suspiciousPatterns.length > 0) {
      context += `- Patterns:\n`;
      data.bundleInfo.suspiciousPatterns.forEach((p) => {
        context += `  - ${p}\n`;
      });
    }
    context += '\n';
  }

  // Trading patterns
  context += `TRADING (24H):\n`;
  context += `- Buys: ${data.buyCount24h} (${data.uniqueBuyers24h} unique)\n`;
  context += `- Sells: ${data.sellCount24h} (${data.uniqueSellers24h} unique)\n`;

  return context;
}
