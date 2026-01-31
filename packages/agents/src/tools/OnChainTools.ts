/**
 * OnChainTools - Blockchain Interaction Tools for Agents
 *
 * Provides:
 * - Token data fetching
 * - Holder distribution analysis
 * - Transaction history
 * - Wallet profiling
 * - LP pool data
 */

export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  supply: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  creator: string;
  createdAt: number;
}

export interface HolderData {
  address: string;
  balance: number;
  percent: number;
  isCreator: boolean;
  isLP: boolean;
}

export interface TransactionData {
  signature: string;
  slot: number;
  timestamp: number;
  type: 'buy' | 'sell' | 'transfer' | 'mint' | 'burn' | 'unknown';
  from: string;
  to: string;
  amount: number;
  price?: number;
}

export interface LPPoolData {
  address: string;
  dex: 'raydium' | 'orca' | 'meteora' | 'pumpfun' | 'unknown';
  token: string;
  pairedToken: string;
  liquidity: number;
  lpBurned: boolean;
  lpLocked: boolean;
  lockExpiry?: number;
}

export interface WalletProfile {
  address: string;
  age: number;
  transactionCount: number;
  tokensHeld: number;
  tokensCreated: number;
  totalVolume: number;
  lastActive: number;
}

export class OnChainTools {
  private rpcEndpoint: string;
  private heliusApiKey?: string;

  constructor(options: { rpcEndpoint: string; heliusApiKey?: string }) {
    this.rpcEndpoint = options.rpcEndpoint;
    this.heliusApiKey = options.heliusApiKey;
  }

  /**
   * Get token metadata and authorities
   */
  async getTokenData(tokenAddress: string): Promise<TokenData | null> {
    try {
      // Get token account info
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-token',
          method: 'getAccountInfo',
          params: [
            tokenAddress,
            { encoding: 'jsonParsed' }
          ]
        })
      });

      const data = await response.json() as any;
      const info = data.result?.value?.data?.parsed?.info;

      if (!info) {
        return null;
      }

      return {
        address: tokenAddress,
        name: info.name || 'Unknown',
        symbol: info.symbol || 'UNKNOWN',
        decimals: info.decimals || 9,
        supply: info.supply ? Number(info.supply) / Math.pow(10, info.decimals || 9) : 0,
        mintAuthority: info.mintAuthority || null,
        freezeAuthority: info.freezeAuthority || null,
        creator: info.mintAuthority || 'unknown',
        createdAt: Date.now() // Would need to query transaction history
      };
    } catch (error) {
      console.error('[OnChainTools] Error fetching token data:', error);
      return null;
    }
  }

  /**
   * Get token holders with distribution
   */
  async getHolders(tokenAddress: string, limit: number = 50): Promise<HolderData[]> {
    try {
      // Use Helius API for efficient holder lookup
      if (this.heliusApiKey) {
        const response = await fetch(
          `https://api.helius.xyz/v0/token-metadata?api-key=${this.heliusApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mintAccounts: [tokenAddress],
              includeOffChain: true
            })
          }
        );

        // Helius would return holder data
        // For now, use getProgramAccounts as fallback
      }

      // Fallback: Use getProgramAccounts (slower but works)
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-holders',
          method: 'getProgramAccounts',
          params: [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            {
              encoding: 'jsonParsed',
              filters: [
                { dataSize: 165 },
                {
                  memcmp: {
                    offset: 0,
                    bytes: tokenAddress
                  }
                }
              ]
            }
          ]
        })
      });

      const data = await response.json() as any;
      const accounts = data.result || [];

      // Parse holders
      const holders: HolderData[] = [];
      let totalSupply = 0;

      for (const account of accounts) {
        const info = account.account?.data?.parsed?.info;
        if (info && info.tokenAmount) {
          const balance = Number(info.tokenAmount.uiAmount) || 0;
          totalSupply += balance;

          holders.push({
            address: info.owner,
            balance,
            percent: 0, // Calculate after total
            isCreator: false,
            isLP: this.isLPAddress(info.owner)
          });
        }
      }

      // Calculate percentages and sort
      for (const holder of holders) {
        holder.percent = totalSupply > 0 ? (holder.balance / totalSupply) * 100 : 0;
      }

      return holders
        .sort((a, b) => b.balance - a.balance)
        .slice(0, limit);

    } catch (error) {
      console.error('[OnChainTools] Error fetching holders:', error);
      return [];
    }
  }

  /**
   * Get recent transactions for a token
   */
  async getTransactions(tokenAddress: string, limit: number = 100): Promise<TransactionData[]> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-sigs',
          method: 'getSignaturesForAddress',
          params: [
            tokenAddress,
            { limit }
          ]
        })
      });

      const data = await response.json() as any;
      const signatures = data.result || [];

      const transactions: TransactionData[] = [];

      // Parse each transaction (simplified - full impl would decode)
      for (const sig of signatures) {
        transactions.push({
          signature: sig.signature,
          slot: sig.slot,
          timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
          type: 'unknown', // Would need to decode to determine
          from: 'unknown',
          to: 'unknown',
          amount: 0
        });
      }

      return transactions;

    } catch (error) {
      console.error('[OnChainTools] Error fetching transactions:', error);
      return [];
    }
  }

  /**
   * Get LP pool information
   */
  async getLPPool(tokenAddress: string): Promise<LPPoolData | null> {
    try {
      // Check Raydium pools
      const raydiumPool = await this.checkRaydiumPool(tokenAddress);
      if (raydiumPool) return raydiumPool;

      // Check pump.fun bonding curve
      const pumpPool = await this.checkPumpFunPool(tokenAddress);
      if (pumpPool) return pumpPool;

      return null;

    } catch (error) {
      console.error('[OnChainTools] Error fetching LP pool:', error);
      return null;
    }
  }

  /**
   * Profile a wallet
   */
  async profileWallet(walletAddress: string): Promise<WalletProfile | null> {
    try {
      // Get transaction count
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-sigs',
          method: 'getSignaturesForAddress',
          params: [walletAddress, { limit: 1000 }]
        })
      });

      const data = await response.json() as any;
      const signatures = data.result || [];

      // Get oldest transaction for age
      const oldest = signatures[signatures.length - 1];
      const age = oldest?.blockTime
        ? Math.floor((Date.now() - oldest.blockTime * 1000) / (1000 * 60 * 60 * 24))
        : 0;

      // Get token accounts
      const tokenResponse = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-tokens',
          method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' }
          ]
        })
      });

      const tokenData = await tokenResponse.json() as any;
      const tokenAccounts = tokenData.result?.value || [];

      return {
        address: walletAddress,
        age,
        transactionCount: signatures.length,
        tokensHeld: tokenAccounts.length,
        tokensCreated: 0, // Would need additional query
        totalVolume: 0, // Would need to sum transaction values
        lastActive: signatures[0]?.blockTime
          ? signatures[0].blockTime * 1000
          : Date.now()
      };

    } catch (error) {
      console.error('[OnChainTools] Error profiling wallet:', error);
      return null;
    }
  }

  /**
   * Get current slot
   */
  async getCurrentSlot(): Promise<number> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-slot',
          method: 'getSlot'
        })
      });

      const data = await response.json() as { result?: number };
      return data.result || 0;

    } catch (error) {
      console.error('[OnChainTools] Error getting slot:', error);
      return 0;
    }
  }

  /**
   * Get SOL balance
   */
  async getBalance(walletAddress: string): Promise<number> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-balance',
          method: 'getBalance',
          params: [walletAddress]
        })
      });

      const data = await response.json() as { result?: { value?: number } };
      return (data.result?.value || 0) / 1e9; // Convert lamports to SOL

    } catch (error) {
      console.error('[OnChainTools] Error getting balance:', error);
      return 0;
    }
  }

  /**
   * Check if address is likely an LP
   */
  private isLPAddress(address: string): boolean {
    // Known LP program addresses
    const lpPrograms = [
      '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', // Raydium
      'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', // Orca
      'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // pump.fun
    ];

    return lpPrograms.some(lp => address.includes(lp));
  }

  /**
   * Check Raydium pool
   */
  private async checkRaydiumPool(tokenAddress: string): Promise<LPPoolData | null> {
    // In production, query Raydium API or on-chain
    return null;
  }

  /**
   * Check pump.fun bonding curve
   */
  private async checkPumpFunPool(tokenAddress: string): Promise<LPPoolData | null> {
    try {
      // pump.fun bonding curve PDA derivation
      const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

      // Check if bonding curve account exists
      // Simplified - would need proper PDA derivation
      return {
        address: `pumpfun_curve_${tokenAddress.slice(0, 8)}`,
        dex: 'pumpfun',
        token: tokenAddress,
        pairedToken: 'So11111111111111111111111111111111111111112', // SOL
        liquidity: 0,
        lpBurned: false,
        lpLocked: true // pump.fun is bonding curve, no LP to burn
      };

    } catch {
      return null;
    }
  }

  /**
   * Batch fetch multiple tokens
   */
  async batchGetTokens(tokenAddresses: string[]): Promise<Map<string, TokenData>> {
    const results = new Map<string, TokenData>();

    // Batch in groups of 10 to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < tokenAddresses.length; i += batchSize) {
      const batch = tokenAddresses.slice(i, i + batchSize);
      const promises = batch.map(addr => this.getTokenData(addr));
      const batchResults = await Promise.all(promises);

      for (let j = 0; j < batch.length; j++) {
        const result = batchResults[j];
        if (result) {
          results.set(batch[j], result);
        }
      }

      // Small delay between batches
      if (i + batchSize < tokenAddresses.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Watch for new token mints (returns async iterator)
   */
  async *watchNewMints(options: {
    pollInterval?: number;
    fromSlot?: number;
  } = {}): AsyncGenerator<TokenData> {
    const pollInterval = options.pollInterval || 10000;
    let lastSlot = options.fromSlot || await this.getCurrentSlot();

    while (true) {
      try {
        const currentSlot = await this.getCurrentSlot();

        if (currentSlot > lastSlot) {
          // Query for InitializeMint instructions
          const response = await fetch(this.rpcEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 'get-sigs',
              method: 'getSignaturesForAddress',
              params: [
                'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                {
                  limit: 100,
                  minContextSlot: lastSlot
                }
              ]
            })
          });

          const data = await response.json() as any;

          // Parse for new mints (simplified)
          for (const sig of data.result || []) {
            // In production, decode transaction to find InitializeMint
            // For now, yield placeholder
            const tokenData = await this.getTokenData(sig.signature);
            if (tokenData) {
              yield tokenData;
            }
          }

          lastSlot = currentSlot;
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));

      } catch (error) {
        console.error('[OnChainTools] Error watching mints:', error);
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }
    }
  }
}
