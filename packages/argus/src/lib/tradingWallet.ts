/**
 * Trading Wallet - Vault Client
 *
 * This module communicates with the secure vault (secure.argusguard.io)
 * via postMessage to handle all private key operations.
 *
 * The private key NEVER exists in this context - it stays isolated
 * in the vault's separate origin, protecting against:
 * - Malicious browser extensions
 * - XSS attacks
 * - Supply chain attacks on dependencies
 *
 * Security model:
 * - App context: Creates transactions, manages UI, makes API calls
 * - Vault context: Holds keys, signs transactions, returns signatures
 */

import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { Buffer } from 'buffer';

const STORAGE_KEY_NAME = 'argus_trading_wallet_name';
const HELIUS_API_KEY = import.meta.env.VITE_HELIUS_API_KEY || '';
const RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : 'https://api.mainnet-beta.solana.com';

// Vault URL - different for production vs local development
const VAULT_URL = import.meta.env.VITE_VAULT_URL ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://secure.argusguard.io');

export interface TradingWalletState {
  publicKey: string;
  balance: number;
  isLoaded: boolean;
  name: string;
}

// ============================================
// Vault Communication
// ============================================

interface VaultMessage {
  type: string;
  id: string;
  payload?: unknown;
}

interface VaultResponse {
  type: string;
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

class VaultClient {
  private iframe: HTMLIFrameElement | null = null;
  private pendingRequests = new Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private isReady = false;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private cachedPublicKey: string | null = null;

  constructor() {
    // Create promise for vault ready state
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });
  }

  /**
   * Initialize the vault iframe and connection
   */
  async init(): Promise<void> {
    if (this.iframe) {
      // Already initialized, just wait for ready
      await this.readyPromise;
      return;
    }

    console.log('[VaultClient] Initializing vault connection to:', VAULT_URL);

    // Create hidden iframe
    this.iframe = document.createElement('iframe');
    this.iframe.id = 'argus-vault-frame';
    this.iframe.src = VAULT_URL;
    this.iframe.style.cssText = 'display:none;width:0;height:0;border:none;position:absolute;';

    // Set up message listener BEFORE adding iframe
    this.messageHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageHandler);

    // Add iframe to document
    document.body.appendChild(this.iframe);

    // Wait for vault to be ready (with timeout)
    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Vault connection timeout')), 10000)
    );

    try {
      await Promise.race([this.readyPromise, timeout]);
      console.log('[VaultClient] Vault connected and ready');
    } catch (error) {
      console.error('[VaultClient] Failed to connect to vault:', error);
      throw error;
    }
  }

  /**
   * Handle incoming messages from the vault
   */
  private handleMessage(event: MessageEvent) {
    // Verify origin
    const allowedOrigins = [
      'https://secure.argusguard.io',
      'http://localhost:3001',
    ];

    if (!allowedOrigins.includes(event.origin)) {
      return; // Ignore messages from other origins
    }

    const response = event.data as VaultResponse;

    // Handle vault ready signal
    if (response.type === 'VAULT_READY') {
      console.log('[VaultClient] Received VAULT_READY signal');
      this.isReady = true;
      this.readyResolve?.();
      return;
    }

    // Handle response to a pending request
    if (response.id && this.pendingRequests.has(response.id)) {
      const { resolve, reject } = this.pendingRequests.get(response.id)!;
      this.pendingRequests.delete(response.id);

      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error || 'Vault request failed'));
      }
    }
  }

  /**
   * Send a message to the vault and wait for response
   */
  private async sendMessage<T>(type: string, payload?: unknown): Promise<T> {
    if (!this.iframe?.contentWindow) {
      throw new Error('Vault not initialized');
    }

    await this.readyPromise;

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const message: VaultMessage = { type, id, payload };

    return new Promise((resolve, reject) => {
      // Set timeout for response
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Vault request timeout: ${type}`));
      }, 30000); // 30 second timeout

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data as T);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      // Send message to vault
      this.iframe!.contentWindow!.postMessage(message, VAULT_URL);
    });
  }

  /**
   * Check if a wallet exists in the vault
   */
  async exists(): Promise<boolean> {
    try {
      const result = await this.sendMessage<{ exists: boolean; publicKey: string | null }>('VAULT_INIT');
      if (result.publicKey) {
        this.cachedPublicKey = result.publicKey;
      }
      return result.exists;
    } catch {
      return false;
    }
  }

  /**
   * Load wallet from vault and return public key
   */
  async load(): Promise<string | null> {
    try {
      const result = await this.sendMessage<{ exists: boolean; publicKey: string | null; name: string }>('VAULT_INIT');
      if (result.exists && result.publicKey) {
        this.cachedPublicKey = result.publicKey;
        return result.publicKey;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate a new wallet in the vault
   */
  async generate(name?: string): Promise<string> {
    const result = await this.sendMessage<{ publicKey: string }>('VAULT_CREATE', { name });
    this.cachedPublicKey = result.publicKey;
    return result.publicKey;
  }

  /**
   * Import a wallet into the vault
   */
  async import(privateKey: string, name?: string): Promise<string> {
    const result = await this.sendMessage<{ publicKey: string }>('VAULT_IMPORT', { privateKey, name });
    this.cachedPublicKey = result.publicKey;
    return result.publicKey;
  }

  /**
   * Sign a transaction in the vault
   */
  async signTransaction(transactionBase64: string, isVersioned: boolean): Promise<string> {
    const result = await this.sendMessage<{ signedTransaction: string }>('VAULT_SIGN', {
      transaction: transactionBase64,
      isVersioned,
    });
    return result.signedTransaction;
  }

  /**
   * Export private key from vault (for backup)
   */
  async exportPrivateKey(): Promise<string | null> {
    try {
      const result = await this.sendMessage<{ privateKey: string }>('VAULT_EXPORT');
      return result.privateKey;
    } catch {
      return null;
    }
  }

  /**
   * Delete wallet from vault
   */
  async delete(): Promise<void> {
    await this.sendMessage('VAULT_DELETE');
    this.cachedPublicKey = null;
  }

  /**
   * Set wallet name in vault
   */
  async setName(name: string): Promise<void> {
    await this.sendMessage('VAULT_SET_NAME', { name });
  }

  /**
   * Get cached public key (sync for compatibility)
   */
  getPublicKey(): string | null {
    return this.cachedPublicKey;
  }

  /**
   * Check if vault is ready
   */
  getIsReady(): boolean {
    return this.isReady && this.cachedPublicKey !== null;
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.pendingRequests.clear();
    this.isReady = false;
  }
}

// ============================================
// Trading Wallet Class (Facade)
// ============================================

export class TradingWallet {
  private vaultClient: VaultClient;
  private connection: Connection;
  private _isInitialized = false;

  constructor() {
    this.vaultClient = new VaultClient();
    this.connection = new Connection(RPC_URL, 'confirmed');
  }

  /**
   * Initialize vault connection - MUST be called before using wallet
   */
  async init(): Promise<void> {
    if (this._isInitialized) return;
    await this.vaultClient.init();
    this._isInitialized = true;
  }

  /**
   * Check if a trading wallet exists in storage
   */
  exists(): boolean {
    // Sync check - relies on cached state from init/load
    return this.vaultClient.getPublicKey() !== null;
  }

  /**
   * Async check if wallet exists
   */
  async existsAsync(): Promise<boolean> {
    await this.init();
    return this.vaultClient.exists();
  }

  /**
   * Load existing wallet from storage
   */
  load(): boolean {
    // Sync version - returns true if already loaded
    return this.vaultClient.getPublicKey() !== null;
  }

  /**
   * Async load wallet
   */
  async loadAsync(): Promise<boolean> {
    await this.init();
    const publicKey = await this.vaultClient.load();
    return publicKey !== null;
  }

  /**
   * Generate a new trading wallet
   */
  async generate(name?: string): Promise<string> {
    await this.init();
    const address = await this.vaultClient.generate(name);
    this.setNameLocal(name || 'Trading Wallet');
    console.log('[TradingWallet] Generated new wallet:', address);
    return address;
  }

  /**
   * Import wallet from private key (base58 encoded)
   */
  async import(privateKeyBase58: string, name?: string): Promise<string> {
    await this.init();
    const address = await this.vaultClient.import(privateKeyBase58, name);
    this.setNameLocal(name || 'Imported Wallet');
    console.log('[TradingWallet] Imported wallet:', address);
    return address;
  }

  /**
   * Delete wallet from storage
   */
  async delete(): Promise<void> {
    await this.init();
    await this.vaultClient.delete();
    localStorage.removeItem(STORAGE_KEY_NAME);
    console.log('[TradingWallet] Deleted');
  }

  /**
   * Get wallet name (stored locally, not in vault)
   */
  getName(): string {
    return localStorage.getItem(STORAGE_KEY_NAME) || 'Trading Wallet';
  }

  /**
   * Set wallet name (stored locally)
   */
  setName(name: string): void {
    this.setNameLocal(name);
    // Also update in vault for consistency
    this.vaultClient.setName(name).catch(() => {});
    console.log('[TradingWallet] Name set to:', name);
  }

  private setNameLocal(name: string): void {
    localStorage.setItem(STORAGE_KEY_NAME, name);
  }

  /**
   * Get public key
   */
  getPublicKey(): PublicKey | null {
    const address = this.vaultClient.getPublicKey();
    return address ? new PublicKey(address) : null;
  }

  /**
   * Get public key as string
   */
  getAddress(): string | null {
    return this.vaultClient.getPublicKey();
  }

  /**
   * Export private key (for backup)
   */
  async exportPrivateKey(): Promise<string | null> {
    await this.init();
    return this.vaultClient.exportPrivateKey();
  }

  /**
   * Get SOL balance
   */
  async getBalance(): Promise<number> {
    const address = this.vaultClient.getPublicKey();
    if (!address) return 0;
    try {
      const balance = await this.connection.getBalance(new PublicKey(address));
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('[TradingWallet] Failed to get balance:', error);
      return 0;
    }
  }

  /**
   * Sign a versioned transaction (for Jupiter swaps)
   * Now returns a Promise since signing happens via postMessage
   */
  async signTransaction(transaction: VersionedTransaction): Promise<VersionedTransaction> {
    await this.init();

    // Serialize transaction to base64
    const serialized = Buffer.from(transaction.serialize()).toString('base64');

    // Send to vault for signing
    const signedBase64 = await this.vaultClient.signTransaction(serialized, true);

    // Deserialize signed transaction
    const signedBuffer = Buffer.from(signedBase64, 'base64');
    return VersionedTransaction.deserialize(signedBuffer);
  }

  /**
   * Sign a legacy transaction
   */
  async signLegacyTransaction(transaction: Transaction): Promise<Transaction> {
    await this.init();

    // Serialize transaction to base64
    const serialized = Buffer.from(transaction.serialize({ verifySignatures: false })).toString('base64');

    // Send to vault for signing
    const signedBase64 = await this.vaultClient.signTransaction(serialized, false);

    // Deserialize signed transaction
    const signedBuffer = Buffer.from(signedBase64, 'base64');
    return Transaction.from(signedBuffer);
  }

  /**
   * Withdraw SOL to another wallet
   */
  async withdraw(destinationAddress: string, amountSol: number): Promise<string> {
    await this.init();

    const publicKeyStr = this.vaultClient.getPublicKey();
    if (!publicKeyStr) throw new Error('Trading wallet not loaded');

    const publicKey = new PublicKey(publicKeyStr);
    const destination = new PublicKey(destinationAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Leave some for transaction fee
    const balance = await this.connection.getBalance(publicKey);
    const maxWithdraw = balance - 5000; // Keep 5000 lamports for fee

    if (lamports > maxWithdraw) {
      throw new Error(`Insufficient balance. Max withdraw: ${(maxWithdraw / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: publicKey,
        toPubkey: destination,
        lamports,
      })
    );

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = publicKey;

    // Sign via vault
    const signedTransaction = await this.signLegacyTransaction(transaction);

    // Send transaction
    const signature = await this.connection.sendRawTransaction(signedTransaction.serialize());

    // Confirm
    await this.connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    console.log('[TradingWallet] Withdrew', amountSol, 'SOL. TX:', signature);
    return signature;
  }

  /**
   * Withdraw all SOL (minus fee) to another wallet
   */
  async withdrawAll(destinationAddress: string): Promise<string> {
    const publicKeyStr = this.vaultClient.getPublicKey();
    if (!publicKeyStr) throw new Error('Trading wallet not loaded');

    const balance = await this.connection.getBalance(new PublicKey(publicKeyStr));
    const withdrawAmount = (balance - 5000) / LAMPORTS_PER_SOL; // Keep 5000 lamports for fee

    if (withdrawAmount <= 0) {
      throw new Error('Insufficient balance for withdrawal');
    }

    return this.withdraw(destinationAddress, withdrawAmount);
  }

  /**
   * Check if wallet is ready for trading
   */
  isReady(): boolean {
    return this.vaultClient.getIsReady();
  }
}

// Singleton instance
export const tradingWallet = new TradingWallet();
