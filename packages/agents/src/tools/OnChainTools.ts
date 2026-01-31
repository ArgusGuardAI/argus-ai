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

// Enhanced holder classification
export type HolderTag = 'DEV' | 'LP' | 'DEX' | 'BURN' | 'BUNDLE' | 'SNIPER' | 'WHALE';

export interface ClassifiedHolder {
  address: string;
  balance: number;
  percent: number;
  tags: HolderTag[];
  label?: string;
  accountOwner?: string; // The program that owns this token account
}

export interface HolderClassificationResult {
  holders: ClassifiedHolder[];
  creator: string | null;
  lpAccounts: string[];
  dexAccounts: string[];
  burnAccounts: string[];
  totalClassified: number;
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
  // TODO: Re-enable when Helius integration is implemented
  // private heliusApiKey?: string;

  constructor(options: { rpcEndpoint: string; heliusApiKey?: string }) {
    this.rpcEndpoint = options.rpcEndpoint;
    // this.heliusApiKey = options.heliusApiKey;
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
      // TODO: Add Helius API support when this.heliusApiKey is available
      // Use getProgramAccounts for now
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
  private async checkRaydiumPool(_tokenAddress: string): Promise<LPPoolData | null> {
    // In production, query Raydium API or on-chain
    return null;
  }

  /**
   * Check pump.fun bonding curve
   */
  private async checkPumpFunPool(tokenAddress: string): Promise<LPPoolData | null> {
    try {
      // pump.fun program: 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
      // TODO: Implement proper PDA derivation for bonding curve lookup
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

  // ============================================
  // HOLDER CLASSIFICATION - On-Chain Analysis
  // ============================================

  /**
   * Known program addresses for classification
   */
  private static readonly KNOWN_PROGRAMS = {
    // AMM/DEX Programs
    RAYDIUM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    RAYDIUM_AMM: '5Q544fKrFoe2tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1',
    RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
    ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
    METEORA: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
    JUPITER: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',

    // Token Programs
    TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    TOKEN_2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',

    // System
    SYSTEM_PROGRAM: '11111111111111111111111111111111',
  };

  /**
   * Known burn addresses
   */
  private static readonly BURN_ADDRESSES = [
    '1111111111111111111111111111111111111111111', // Null address
    '1nc1nerator11111111111111111111111111111111', // Incinerator
  ];

  /**
   * Get the token creator by finding the mint initialization transaction
   */
  async getTokenCreator(tokenAddress: string): Promise<string | null> {
    try {
      // Get the first transaction signatures for the mint account
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-mint-sigs',
          method: 'getSignaturesForAddress',
          params: [
            tokenAddress,
            { limit: 1, before: null } // Get oldest by reversing
          ]
        })
      });

      const sigData = await response.json() as any;
      const signatures = sigData.result || [];

      if (signatures.length === 0) {
        return null;
      }

      // Get the oldest signature (mint creation)
      // Actually we need to get ALL and find the oldest
      const allSigsResponse = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-all-sigs',
          method: 'getSignaturesForAddress',
          params: [tokenAddress, { limit: 1000 }]
        })
      });

      const allSigsData = await allSigsResponse.json() as any;
      const allSigs = allSigsData.result || [];

      if (allSigs.length === 0) return null;

      // Get the oldest transaction (last in array)
      const oldestSig = allSigs[allSigs.length - 1].signature;

      // Fetch the full transaction to get the signer
      const txResponse = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'get-tx',
          method: 'getTransaction',
          params: [
            oldestSig,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
          ]
        })
      });

      const txData = await txResponse.json() as any;
      const tx = txData.result;

      if (!tx) return null;

      // The first signer is typically the creator (fee payer)
      const signers = tx.transaction?.message?.accountKeys?.filter(
        (key: any) => key.signer === true
      ) || [];

      if (signers.length > 0) {
        return signers[0].pubkey;
      }

      return null;

    } catch (error) {
      console.error('[OnChainTools] Error getting token creator:', error);
      return null;
    }
  }

  /**
   * Check if an address is owned by an AMM/DEX program (making it an LP account)
   */
  async checkIfLPAccount(address: string): Promise<{ isLP: boolean; program?: string }> {
    try {
      const response = await fetch(this.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'check-lp',
          method: 'getAccountInfo',
          params: [address, { encoding: 'jsonParsed' }]
        })
      });

      const data = await response.json() as any;
      const accountInfo = data.result?.value;

      if (!accountInfo) {
        return { isLP: false };
      }

      const owner = accountInfo.owner;

      // Check if owner is a known AMM program
      const ammPrograms = [
        OnChainTools.KNOWN_PROGRAMS.RAYDIUM_V4,
        OnChainTools.KNOWN_PROGRAMS.RAYDIUM_AMM,
        OnChainTools.KNOWN_PROGRAMS.RAYDIUM_CLMM,
        OnChainTools.KNOWN_PROGRAMS.ORCA_WHIRLPOOL,
        OnChainTools.KNOWN_PROGRAMS.METEORA,
        OnChainTools.KNOWN_PROGRAMS.METEORA_DLMM,
        OnChainTools.KNOWN_PROGRAMS.PUMP_FUN,
      ];

      if (ammPrograms.includes(owner)) {
        return { isLP: true, program: owner };
      }

      return { isLP: false };

    } catch (error) {
      console.error('[OnChainTools] Error checking LP account:', error);
      return { isLP: false };
    }
  }

  /**
   * Classify a single holder address
   */
  async classifyHolder(
    holderAddress: string,
    tokenCreator: string | null,
    bundleWallets: Set<string> = new Set()
  ): Promise<{ tags: HolderTag[]; label?: string; accountOwner?: string }> {
    const tags: HolderTag[] = [];
    let label: string | undefined;
    let accountOwner: string | undefined;

    // Check burn address
    if (OnChainTools.BURN_ADDRESSES.some(burn => holderAddress.startsWith(burn.slice(0, 20)))) {
      tags.push('BURN');
      label = 'Burn Address';
      return { tags, label };
    }

    // Check if this is the creator
    if (tokenCreator && holderAddress === tokenCreator) {
      tags.push('DEV');
      label = 'Token Creator';
    }

    // Check if in bundle set
    if (bundleWallets.has(holderAddress)) {
      tags.push('BUNDLE');
    }

    // Check if LP account (owned by AMM program)
    const lpCheck = await this.checkIfLPAccount(holderAddress);
    if (lpCheck.isLP) {
      tags.push('LP');
      accountOwner = lpCheck.program;

      // Add specific label based on program
      if (lpCheck.program === OnChainTools.KNOWN_PROGRAMS.RAYDIUM_V4) {
        label = 'Raydium LP';
      } else if (lpCheck.program === OnChainTools.KNOWN_PROGRAMS.ORCA_WHIRLPOOL) {
        label = 'Orca LP';
      } else if (lpCheck.program === OnChainTools.KNOWN_PROGRAMS.METEORA) {
        label = 'Meteora LP';
      } else if (lpCheck.program === OnChainTools.KNOWN_PROGRAMS.PUMP_FUN) {
        label = 'Pump.fun Bonding Curve';
      }
    }

    // Check if address itself is a known DEX program (rare but possible)
    const dexPrograms = Object.values(OnChainTools.KNOWN_PROGRAMS);
    if (dexPrograms.includes(holderAddress)) {
      tags.push('DEX');
      label = 'DEX Program';
    }

    return { tags, label, accountOwner };
  }

  /**
   * Classify all holders for a token - FULL ON-CHAIN ANALYSIS
   * No external APIs needed, uses only RPC data
   */
  async classifyAllHolders(
    tokenAddress: string,
    bundleWallets: Set<string> = new Set(),
    limit: number = 50
  ): Promise<HolderClassificationResult> {
    console.log(`[OnChainTools] Classifying holders for ${tokenAddress}`);

    // Step 1: Get the token creator
    const creator = await this.getTokenCreator(tokenAddress);
    console.log(`[OnChainTools] Token creator: ${creator || 'unknown'}`);

    // Step 2: Get all holders
    const holders = await this.getHolders(tokenAddress, limit);
    console.log(`[OnChainTools] Found ${holders.length} holders`);

    // Step 3: Classify each holder
    const classifiedHolders: ClassifiedHolder[] = [];
    const lpAccounts: string[] = [];
    const dexAccounts: string[] = [];
    const burnAccounts: string[] = [];

    for (const holder of holders) {
      const classification = await this.classifyHolder(
        holder.address,
        creator,
        bundleWallets
      );

      const classified: ClassifiedHolder = {
        address: holder.address,
        balance: holder.balance,
        percent: holder.percent,
        tags: classification.tags,
        label: classification.label,
        accountOwner: classification.accountOwner,
      };

      classifiedHolders.push(classified);

      // Track by type
      if (classification.tags.includes('LP')) {
        lpAccounts.push(holder.address);
      }
      if (classification.tags.includes('DEX')) {
        dexAccounts.push(holder.address);
      }
      if (classification.tags.includes('BURN')) {
        burnAccounts.push(holder.address);
      }
    }

    const totalClassified = classifiedHolders.filter(h => h.tags.length > 0).length;
    console.log(`[OnChainTools] Classified ${totalClassified}/${holders.length} holders`);

    return {
      holders: classifiedHolders,
      creator,
      lpAccounts,
      dexAccounts,
      burnAccounts,
      totalClassified,
    };
  }

  /**
   * Quick classification without RPC calls for each holder
   * Uses heuristics based on address patterns and holder data
   */
  classifyHolderQuick(
    holder: HolderData,
    tokenCreator: string | null,
    bundleWallets: Set<string> = new Set()
  ): { tags: HolderTag[]; label?: string } {
    const tags: HolderTag[] = [];
    let label: string | undefined;

    // Check burn
    if (OnChainTools.BURN_ADDRESSES.some(burn => holder.address.startsWith(burn.slice(0, 20)))) {
      tags.push('BURN');
      label = 'Burn Address';
      return { tags, label };
    }

    // Check creator
    if (tokenCreator && holder.address === tokenCreator) {
      tags.push('DEV');
      label = 'Token Creator';
    }

    // Check bundle
    if (bundleWallets.has(holder.address)) {
      tags.push('BUNDLE');
    }

    // Use existing isLP flag
    if (holder.isLP) {
      tags.push('LP');
    }

    // Whale detection (>5% not LP/DEV/BURN)
    if (holder.percent > 5 && tags.length === 0) {
      tags.push('WHALE');
    }

    return { tags, label };
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
