/**
 * Trading Wallet - Dedicated wallet for automated trading
 *
 * This wallet is controlled by the app and signs transactions instantly
 * without any popups or confirmations. User funds this wallet with a small
 * amount for trading, keeping main wallet safe.
 *
 * Security:
 * - Private key stored encrypted in localStorage
 * - Only used for small trading amounts
 * - User can withdraw to main wallet anytime
 */

import {
  Keypair,
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';

const STORAGE_KEY = 'argus_trading_wallet';
const STORAGE_KEY_NAME = 'argus_trading_wallet_name';
const HELIUS_API_KEY = '54846763-d323-4cb5-8d67-23ed50c19d10';
const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export interface TradingWalletState {
  publicKey: string;
  balance: number;
  isLoaded: boolean;
  name: string;
}

/**
 * Simple encryption for localStorage (not military-grade, but prevents casual snooping)
 * In production, consider using Web Crypto API with user-provided password
 */
function encrypt(data: string): string {
  // Simple XOR with a key derived from the domain
  const key = window.location.hostname.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return btoa(data.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 256))).join(''));
}

function decrypt(data: string): string {
  const key = window.location.hostname.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const decoded = atob(data);
  return decoded.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 256))).join('');
}

export class TradingWallet {
  private keypair: Keypair | null = null;
  private connection: Connection;

  constructor() {
    this.connection = new Connection(RPC_URL, 'confirmed');
  }

  /**
   * Check if a trading wallet exists in storage
   */
  exists(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  /**
   * Load existing wallet from storage
   */
  load(): boolean {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;

      const decrypted = decrypt(stored);
      const secretKey = bs58.decode(decrypted);
      this.keypair = Keypair.fromSecretKey(secretKey);

      console.log('[TradingWallet] Loaded:', this.keypair.publicKey.toString());
      return true;
    } catch (error) {
      console.error('[TradingWallet] Failed to load:', error);
      return false;
    }
  }

  /**
   * Generate a new trading wallet
   */
  generate(name?: string): string {
    this.keypair = Keypair.generate();
    this.save();
    this.setName(name || 'Trading Wallet');
    console.log('[TradingWallet] Generated new wallet:', this.keypair.publicKey.toString());
    return this.keypair.publicKey.toString();
  }

  /**
   * Import wallet from private key (base58 encoded)
   */
  import(privateKeyBase58: string, name?: string): string {
    try {
      const secretKey = bs58.decode(privateKeyBase58);
      this.keypair = Keypair.fromSecretKey(secretKey);
      this.save();
      this.setName(name || 'Imported Wallet');
      console.log('[TradingWallet] Imported wallet:', this.keypair.publicKey.toString());
      return this.keypair.publicKey.toString();
    } catch (error) {
      throw new Error('Invalid private key format');
    }
  }

  /**
   * Save wallet to encrypted storage
   */
  private save(): void {
    if (!this.keypair) return;
    const encoded = bs58.encode(this.keypair.secretKey);
    const encrypted = encrypt(encoded);
    localStorage.setItem(STORAGE_KEY, encrypted);
  }

  /**
   * Delete wallet from storage
   */
  delete(): void {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY_NAME);
    this.keypair = null;
    console.log('[TradingWallet] Deleted');
  }

  /**
   * Get wallet name
   */
  getName(): string {
    return localStorage.getItem(STORAGE_KEY_NAME) || 'Trading Wallet';
  }

  /**
   * Set wallet name
   */
  setName(name: string): void {
    localStorage.setItem(STORAGE_KEY_NAME, name);
    console.log('[TradingWallet] Name set to:', name);
  }

  /**
   * Get public key
   */
  getPublicKey(): PublicKey | null {
    return this.keypair?.publicKey || null;
  }

  /**
   * Get public key as string
   */
  getAddress(): string | null {
    return this.keypair?.publicKey.toString() || null;
  }

  /**
   * Export private key (for backup)
   */
  exportPrivateKey(): string | null {
    if (!this.keypair) return null;
    return bs58.encode(this.keypair.secretKey);
  }

  /**
   * Get SOL balance
   */
  async getBalance(): Promise<number> {
    if (!this.keypair) return 0;
    try {
      const balance = await this.connection.getBalance(this.keypair.publicKey);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('[TradingWallet] Failed to get balance:', error);
      return 0;
    }
  }

  /**
   * Sign a versioned transaction (for Jupiter swaps)
   */
  signTransaction(transaction: VersionedTransaction): VersionedTransaction {
    if (!this.keypair) throw new Error('Trading wallet not loaded');
    transaction.sign([this.keypair]);
    return transaction;
  }

  /**
   * Sign a legacy transaction
   */
  signLegacyTransaction(transaction: Transaction): Transaction {
    if (!this.keypair) throw new Error('Trading wallet not loaded');
    transaction.sign(this.keypair);
    return transaction;
  }

  /**
   * Withdraw SOL to another wallet
   */
  async withdraw(destinationAddress: string, amountSol: number): Promise<string> {
    if (!this.keypair) throw new Error('Trading wallet not loaded');

    const destination = new PublicKey(destinationAddress);
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Leave some for transaction fee
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    const maxWithdraw = balance - 5000; // Keep 5000 lamports for fee

    if (lamports > maxWithdraw) {
      throw new Error(`Insufficient balance. Max withdraw: ${(maxWithdraw / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: destination,
        lamports,
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair],
      { commitment: 'confirmed' }
    );

    console.log('[TradingWallet] Withdrew', amountSol, 'SOL. TX:', signature);
    return signature;
  }

  /**
   * Withdraw all SOL (minus fee) to another wallet
   */
  async withdrawAll(destinationAddress: string): Promise<string> {
    if (!this.keypair) throw new Error('Trading wallet not loaded');

    const balance = await this.connection.getBalance(this.keypair.publicKey);
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
    return this.keypair !== null;
  }
}

// Singleton instance
export const tradingWallet = new TradingWallet();
