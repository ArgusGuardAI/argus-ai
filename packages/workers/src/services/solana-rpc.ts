/**
 * Solana RPC Client
 *
 * Direct JSON-RPC calls to Solana nodes.
 * Works with any RPC endpoint (public nodes, Helius, QuickNode, etc.)
 * No external dependencies - pure fetch-based implementation.
 */

// YOUR OWN NODE - NO THIRD PARTY APIS
// Set SOLANA_RPC_URL in environment variables

// Known program IDs
export const PROGRAMS = {
  TOKEN_PROGRAM: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  TOKEN_2022_PROGRAM: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ASSOCIATED_TOKEN_PROGRAM: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  SYSTEM_PROGRAM: '11111111111111111111111111111111',
  // DEX Programs
  RAYDIUM_AMM_V4: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  METEORA_DLMM: 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo',
  PUMPFUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  PUMPSWAP: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
};

// Token mints
export const TOKENS = {
  SOL: 'So11111111111111111111111111111111111111112', // Wrapped SOL
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

interface RpcResponse<T> {
  jsonrpc: string;
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

export class SolanaRpcClient {
  private endpoint: string;
  private requestId = 0;

  constructor(endpoint?: string) {
    if (!endpoint) {
      throw new Error('SOLANA_RPC_URL must be provided. No third-party fallbacks allowed.');
    }
    this.endpoint = endpoint;
  }

  /**
   * Make a JSON-RPC call to the Solana node
   */
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`RPC error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as RpcResponse<T>;

    if (data.error) {
      throw new Error(`RPC error ${data.error.code}: ${data.error.message}`);
    }

    return data.result as T;
  }

  /**
   * Batch multiple RPC calls into a single request
   */
  async batchCall<T>(calls: Array<{ method: string; params: unknown[] }>): Promise<T[]> {
    const batch = calls.map((call, i) => ({
      jsonrpc: '2.0',
      id: i,
      method: call.method,
      params: call.params,
    }));

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
    });

    if (!response.ok) {
      throw new Error(`RPC batch error: ${response.status}`);
    }

    const results = await response.json() as Array<RpcResponse<T>>;

    // Sort by id to maintain order
    results.sort((a, b) => Number(a.id) - Number(b.id));

    return results.map(r => {
      if (r.error) {
        console.warn(`RPC batch call error: ${r.error.message}`);
        return null as T;
      }
      return r.result as T;
    });
  }

  // ============================================
  // BASIC RPC METHODS
  // ============================================

  /**
   * Get account info for a public key
   */
  async getAccountInfo(pubkey: string, encoding: 'base64' | 'jsonParsed' = 'jsonParsed') {
    return this.call<{
      context: { slot: number };
      value: {
        data: unknown;
        executable: boolean;
        lamports: number;
        owner: string;
        rentEpoch: number;
      } | null;
    }>('getAccountInfo', [pubkey, { encoding }]);
  }

  /**
   * Get multiple accounts in a single call
   */
  async getMultipleAccounts(pubkeys: string[], encoding: 'base64' | 'jsonParsed' = 'jsonParsed') {
    return this.call<{
      context: { slot: number };
      value: Array<{
        data: unknown;
        executable: boolean;
        lamports: number;
        owner: string;
        rentEpoch: number;
      } | null>;
    }>('getMultipleAccounts', [pubkeys, { encoding }]);
  }

  /**
   * Get token supply
   */
  async getTokenSupply(mint: string) {
    return this.call<{
      context: { slot: number };
      value: {
        amount: string;
        decimals: number;
        uiAmount: number;
        uiAmountString: string;
      };
    }>('getTokenSupply', [mint]);
  }

  /**
   * Get largest token accounts (top holders)
   */
  async getTokenLargestAccounts(mint: string) {
    return this.call<{
      context: { slot: number };
      value: Array<{
        address: string;
        amount: string;
        decimals: number;
        uiAmount: number;
        uiAmountString: string;
      }>;
    }>('getTokenLargestAccounts', [mint]);
  }

  /**
   * Get token accounts by owner
   */
  async getTokenAccountsByOwner(owner: string, mint?: string) {
    const filter = mint
      ? { mint }
      : { programId: PROGRAMS.TOKEN_PROGRAM };

    return this.call<{
      context: { slot: number };
      value: Array<{
        account: {
          data: {
            parsed: {
              info: {
                mint: string;
                owner: string;
                tokenAmount: {
                  amount: string;
                  decimals: number;
                  uiAmount: number;
                };
              };
            };
          };
          lamports: number;
        };
        pubkey: string;
      }>;
    }>('getTokenAccountsByOwner', [owner, filter, { encoding: 'jsonParsed' }]);
  }

  /**
   * Get signatures for an address (transaction history)
   */
  async getSignaturesForAddress(
    address: string,
    options: { limit?: number; before?: string; until?: string } = {}
  ) {
    return this.call<Array<{
      signature: string;
      slot: number;
      blockTime: number | null;
      err: unknown | null;
      memo: string | null;
      confirmationStatus: string;
    }>>('getSignaturesForAddress', [address, options]);
  }

  /**
   * Get parsed transaction
   */
  async getTransaction(signature: string) {
    return this.call<{
      slot: number;
      blockTime: number | null;
      transaction: {
        message: {
          accountKeys: Array<{
            pubkey: string;
            signer: boolean;
            writable: boolean;
            source?: string;
          }>;
          instructions: Array<{
            programId: string;
            accounts: string[];
            data: string;
            parsed?: {
              type: string;
              info: Record<string, unknown>;
            };
          }>;
          recentBlockhash: string;
        };
        signatures: string[];
      };
      meta: {
        err: unknown | null;
        fee: number;
        preBalances: number[];
        postBalances: number[];
        preTokenBalances: Array<{
          accountIndex: number;
          mint: string;
          owner: string;
          uiTokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number;
          };
        }>;
        postTokenBalances: Array<{
          accountIndex: number;
          mint: string;
          owner: string;
          uiTokenAmount: {
            amount: string;
            decimals: number;
            uiAmount: number;
          };
        }>;
        innerInstructions: Array<{
          index: number;
          instructions: Array<{
            programId: string;
            accounts: string[];
            data: string;
          }>;
        }>;
        logMessages: string[];
      };
    } | null>('getTransaction', [signature, {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
    }]);
  }

  /**
   * Get current slot
   */
  async getSlot(): Promise<number> {
    return this.call<number>('getSlot');
  }

  /**
   * Get block time for a slot
   */
  async getBlockTime(slot: number): Promise<number | null> {
    return this.call<number | null>('getBlockTime', [slot]);
  }

  /**
   * Get recent blockhash
   */
  async getLatestBlockhash() {
    return this.call<{
      context: { slot: number };
      value: {
        blockhash: string;
        lastValidBlockHeight: number;
      };
    }>('getLatestBlockhash');
  }

  /**
   * Get program accounts (find all accounts owned by a program)
   */
  async getProgramAccounts(
    programId: string,
    filters?: Array<{ memcmp?: { offset: number; bytes: string }; dataSize?: number }>
  ) {
    const config: Record<string, unknown> = { encoding: 'jsonParsed' };
    if (filters) {
      config.filters = filters;
    }

    return this.call<Array<{
      account: {
        data: unknown;
        executable: boolean;
        lamports: number;
        owner: string;
        rentEpoch: number;
      };
      pubkey: string;
    }>>('getProgramAccounts', [programId, config]);
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  /**
   * Check if an account exists
   */
  async accountExists(pubkey: string): Promise<boolean> {
    try {
      const info = await this.getAccountInfo(pubkey);
      return info.value !== null;
    } catch {
      return false;
    }
  }

  /**
   * Get SOL balance for an address
   */
  async getBalance(pubkey: string): Promise<number> {
    const lamports = await this.call<number>('getBalance', [pubkey]);
    return lamports / 1e9; // Convert to SOL
  }

  /**
   * Get wallet age in days from first transaction
   */
  async getWalletAgeDays(address: string): Promise<number> {
    try {
      // Get oldest signatures (they come in reverse order, so we need to page backwards)
      const sigs = await this.getSignaturesForAddress(address, { limit: 1000 });

      if (sigs.length === 0) return 0;

      // The last signature in the array is the oldest we fetched
      const oldestSig = sigs[sigs.length - 1];

      if (!oldestSig.blockTime) return -1;

      const ageMs = Date.now() - (oldestSig.blockTime * 1000);
      return Math.floor(ageMs / (1000 * 60 * 60 * 24));
    } catch {
      return -1;
    }
  }

  /**
   * Get first funder of a wallet (who sent the first SOL)
   */
  async getFirstFunder(address: string): Promise<string | null> {
    try {
      const sigs = await this.getSignaturesForAddress(address, { limit: 10 });

      if (sigs.length === 0) return null;

      // Get the oldest transaction
      const oldestSig = sigs[sigs.length - 1];
      const tx = await this.getTransaction(oldestSig.signature);

      if (!tx) return null;

      // Find the account that's not the target address
      for (const account of tx.transaction.message.accountKeys) {
        if (account.pubkey !== address && account.signer) {
          return account.pubkey;
        }
      }

      return null;
    } catch {
      return null;
    }
  }
}

// NOTE: No default instance - must provide SOLANA_RPC_URL

import { createMultiRpcClient, type MultiRpcClient } from './multi-rpc';

/**
 * SolanaRpcClient with Multi-RPC fallback support
 * Automatically rotates through endpoints on failure
 */
export class MultiRpcSolanaClient extends SolanaRpcClient {
  private multiRpc: MultiRpcClient;

  constructor(multiRpc: MultiRpcClient) {
    super(multiRpc.getPrimaryEndpoint());
    this.multiRpc = multiRpc;
  }

  /**
   * Override call to use multi-RPC with fallback
   */
  override async call<T>(method: string, params: unknown[] = []): Promise<T> {
    return this.multiRpc.call<T>(method, params);
  }

  /**
   * Get status of all RPC endpoints
   */
  getRpcStatus() {
    return this.multiRpc.getStatus();
  }
}

/**
 * Create a SolanaRpcClient with multi-RPC support
 *
 * YOUR OWN NODE ONLY - NO THIRD PARTY APIS
 */
export function createSolanaRpcClientFromEnv(env: {
  SOLANA_RPC_URL?: string;
}): MultiRpcSolanaClient {
  const multiRpc = createMultiRpcClient(env);
  return new MultiRpcSolanaClient(multiRpc);
}
