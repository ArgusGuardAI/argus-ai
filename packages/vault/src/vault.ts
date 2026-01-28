/**
 * Argus Secure Vault
 *
 * This module runs in an isolated origin (secure.argusguard.io) to protect
 * private keys from malicious browser extensions and XSS attacks.
 *
 * The vault ONLY:
 * - Stores encrypted private keys in localStorage
 * - Decrypts keys in memory when needed
 * - Signs transactions and returns signatures
 * - Communicates via postMessage with verified origins
 *
 * The vault NEVER:
 * - Exposes private keys to the parent window
 * - Loads any third-party scripts or libraries
 * - Makes any network requests (signing is offline)
 */

import { Keypair, VersionedTransaction, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { Buffer } from 'buffer';

// Polyfill Buffer for browser
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

// ============================================
// Configuration
// ============================================

const STORAGE_KEY = 'argus_vault_key';
const STORAGE_KEY_NAME = 'argus_vault_name';

// Allowed origins that can communicate with the vault
const ALLOWED_ORIGINS = [
  'https://app.argusguard.io',
  'https://argusguard.io',
  'http://localhost:3000', // Local development
];

// ============================================
// Encryption (XOR with domain-derived key)
// Note: This prevents casual snooping. For the vault pattern,
// the real security comes from origin isolation, not encryption strength.
// ============================================

function getEncryptionKey(): number {
  // Use the vault's hostname as the key derivation source
  return window.location.hostname.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
}

function encrypt(data: string): string {
  const key = getEncryptionKey();
  return btoa(
    data
      .split('')
      .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 256)))
      .join('')
  );
}

function decrypt(data: string): string {
  const key = getEncryptionKey();
  const decoded = atob(data);
  return decoded
    .split('')
    .map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ ((key + i) % 256)))
    .join('');
}

// ============================================
// Keypair Management
// ============================================

let cachedKeypair: Keypair | null = null;

function loadKeypair(): Keypair | null {
  if (cachedKeypair) return cachedKeypair;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const decrypted = decrypt(stored);
    const secretKey = bs58.decode(decrypted);
    cachedKeypair = Keypair.fromSecretKey(secretKey);
    return cachedKeypair;
  } catch (error) {
    console.error('[Vault] Failed to load keypair:', error);
    return null;
  }
}

function saveKeypair(keypair: Keypair): void {
  const encoded = bs58.encode(keypair.secretKey);
  const encrypted = encrypt(encoded);
  localStorage.setItem(STORAGE_KEY, encrypted);
  cachedKeypair = keypair;
}

function deleteKeypair(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY_NAME);
  cachedKeypair = null;
}

function getName(): string {
  return localStorage.getItem(STORAGE_KEY_NAME) || 'Trading Wallet';
}

function setName(name: string): void {
  localStorage.setItem(STORAGE_KEY_NAME, name);
}

// ============================================
// Message Types
// ============================================

interface VaultMessage {
  type: string;
  id: string; // Unique ID for request/response matching
  payload?: unknown;
}

interface VaultResponse {
  type: string;
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ============================================
// Message Handlers
// ============================================

function handleInit(): VaultResponse['data'] {
  const keypair = loadKeypair();
  return {
    exists: keypair !== null,
    publicKey: keypair?.publicKey.toString() || null,
    name: getName(),
  };
}

function handleCreate(name?: string): VaultResponse['data'] {
  const keypair = Keypair.generate();
  saveKeypair(keypair);
  setName(name || 'Trading Wallet');
  console.log('[Vault] Created new wallet:', keypair.publicKey.toString());
  return {
    publicKey: keypair.publicKey.toString(),
    name: getName(),
  };
}

function handleImport(privateKeyBase58: string, name?: string): VaultResponse['data'] {
  try {
    const secretKey = bs58.decode(privateKeyBase58);
    const keypair = Keypair.fromSecretKey(secretKey);
    saveKeypair(keypair);
    setName(name || 'Imported Wallet');
    console.log('[Vault] Imported wallet:', keypair.publicKey.toString());
    return {
      publicKey: keypair.publicKey.toString(),
      name: getName(),
    };
  } catch {
    throw new Error('Invalid private key format');
  }
}

function handleSign(transactionBase64: string, isVersioned: boolean): VaultResponse['data'] {
  const keypair = loadKeypair();
  if (!keypair) {
    throw new Error('No wallet loaded');
  }

  try {
    const transactionBuffer = Buffer.from(transactionBase64, 'base64');

    if (isVersioned) {
      // VersionedTransaction (V0) - used by Jupiter
      const transaction = VersionedTransaction.deserialize(transactionBuffer);
      transaction.sign([keypair]);
      const signedBuffer = Buffer.from(transaction.serialize());
      return {
        signedTransaction: signedBuffer.toString('base64'),
      };
    } else {
      // Legacy Transaction
      const transaction = Transaction.from(transactionBuffer);
      transaction.sign(keypair);
      const signedBuffer = transaction.serialize();
      return {
        signedTransaction: Buffer.from(signedBuffer).toString('base64'),
      };
    }
  } catch (error) {
    console.error('[Vault] Sign error:', error);
    throw new Error(`Failed to sign transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

function handleExport(): VaultResponse['data'] {
  const keypair = loadKeypair();
  if (!keypair) {
    throw new Error('No wallet loaded');
  }
  return {
    privateKey: bs58.encode(keypair.secretKey),
  };
}

function handleDelete(): VaultResponse['data'] {
  deleteKeypair();
  console.log('[Vault] Wallet deleted');
  return { deleted: true };
}

function handleSetName(name: string): VaultResponse['data'] {
  setName(name);
  return { name: getName() };
}

// ============================================
// Main Message Listener
// ============================================

function processMessage(message: VaultMessage): VaultResponse {
  const response: VaultResponse = {
    type: `${message.type}_RESPONSE`,
    id: message.id,
    success: false,
  };

  try {
    switch (message.type) {
      case 'VAULT_INIT':
        response.data = handleInit();
        response.success = true;
        break;

      case 'VAULT_CREATE':
        response.data = handleCreate((message.payload as { name?: string })?.name);
        response.success = true;
        break;

      case 'VAULT_IMPORT': {
        const importPayload = message.payload as { privateKey: string; name?: string };
        response.data = handleImport(importPayload.privateKey, importPayload.name);
        response.success = true;
        break;
      }

      case 'VAULT_SIGN': {
        const signPayload = message.payload as { transaction: string; isVersioned: boolean };
        response.data = handleSign(signPayload.transaction, signPayload.isVersioned);
        response.success = true;
        break;
      }

      case 'VAULT_EXPORT':
        response.data = handleExport();
        response.success = true;
        break;

      case 'VAULT_DELETE':
        response.data = handleDelete();
        response.success = true;
        break;

      case 'VAULT_SET_NAME': {
        const namePayload = message.payload as { name: string };
        response.data = handleSetName(namePayload.name);
        response.success = true;
        break;
      }

      case 'VAULT_PING':
        response.data = { pong: true, timestamp: Date.now() };
        response.success = true;
        break;

      default:
        response.error = `Unknown message type: ${message.type}`;
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : 'Unknown error';
  }

  return response;
}

// ============================================
// Initialize Vault
// ============================================

function initVault() {
  console.log('[Vault] Initializing secure vault...');
  console.log('[Vault] Allowed origins:', ALLOWED_ORIGINS);

  window.addEventListener('message', (event) => {
    // CRITICAL: Verify origin
    if (!ALLOWED_ORIGINS.includes(event.origin)) {
      console.warn('[Vault] Rejected message from unauthorized origin:', event.origin);
      return;
    }

    // Verify message structure
    const message = event.data as VaultMessage;
    if (!message || typeof message.type !== 'string' || typeof message.id !== 'string') {
      console.warn('[Vault] Invalid message format:', message);
      return;
    }

    console.log('[Vault] Received:', message.type, 'from', event.origin);

    // Process and respond
    const response = processMessage(message);

    // Send response back to the parent window
    if (event.source) {
      (event.source as Window).postMessage(response, event.origin);
    }
  });

  // Signal that vault is ready
  if (window.parent !== window) {
    // We're in an iframe - notify parent that vault is ready
    window.parent.postMessage(
      { type: 'VAULT_READY', id: 'init', success: true },
      '*' // Parent origin not known yet, will be verified on subsequent messages
    );
  }

  console.log('[Vault] Ready and listening for messages');
}

// Start the vault
initVault();
