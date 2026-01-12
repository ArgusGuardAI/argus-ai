/**
 * Authentication & Token Gating Service
 * Verifies wallet signatures and checks $WHALESHIELD token balance
 *
 * Uses lightweight libraries compatible with Cloudflare Workers
 */

import nacl from 'tweetnacl';
import bs58 from 'bs58';

// WhaleShield token configuration
const REQUIRED_BALANCE = 1000; // Minimum tokens required for premium features
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';

function getHeliusRpcUrl(apiKey: string): string {
  return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
}

/**
 * Verify a wallet signature to prove ownership
 * The user signs a message with their wallet, we verify with their public key
 */
export function verifySignature(
  walletAddress: string,
  message: string,
  signature: string
): boolean {
  try {
    // Decode the wallet address (base58) to get public key bytes
    const publicKeyBytes = bs58.decode(walletAddress);

    // Decode the signature from base58
    const signatureBytes = bs58.decode(signature);

    // Encode the message as bytes
    const messageBytes = new TextEncoder().encode(message);

    // Verify using nacl (Ed25519)
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Generate the message that users should sign for authentication
 * This creates a unique, timestamped message to prevent replay attacks
 */
export function generateSignMessage(action: string, tokenAddress?: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const parts = ['WhaleShield', action];
  if (tokenAddress) {
    parts.push(tokenAddress);
  }
  parts.push(timestamp.toString());
  return parts.join(':');
}

/**
 * Verify a signed message is recent (within 5 minutes)
 */
export function isMessageRecent(message: string, maxAgeSeconds = 300): boolean {
  try {
    const parts = message.split(':');
    const timestamp = parseInt(parts[parts.length - 1], 10);
    if (isNaN(timestamp)) return false;
    const now = Math.floor(Date.now() / 1000);
    return now - timestamp <= maxAgeSeconds;
  } catch {
    return false;
  }
}

/**
 * Check if a wallet holds the required $WHALESHIELD tokens
 */
export async function checkTokenBalance(
  walletAddress: string,
  mintAddress: string,
  requiredBalance: number = REQUIRED_BALANCE,
  heliusApiKey?: string
): Promise<{ hasBalance: boolean; balance: number }> {
  try {
    const rpcUrl = heliusApiKey ? getHeliusRpcUrl(heliusApiKey) : SOLANA_RPC_URL;

    // Get token accounts for the wallet
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenAccountsByOwner',
        params: [
          walletAddress,
          { mint: mintAddress },
          { encoding: 'jsonParsed' },
        ],
      }),
    });

    const data = await response.json() as {
      result?: {
        value?: Array<{
          account: {
            data: {
              parsed: {
                info: {
                  tokenAmount: {
                    uiAmount: number;
                  };
                };
              };
            };
          };
        }>;
      };
      error?: { message: string };
    };

    if (data.error) {
      console.warn('RPC error checking balance:', data.error.message);
      return { hasBalance: false, balance: 0 };
    }

    const accounts = data.result?.value || [];

    if (accounts.length === 0) {
      return { hasBalance: false, balance: 0 };
    }

    // Sum up balance from all token accounts
    const totalBalance = accounts.reduce((sum, acc) => {
      const amount = acc.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
      return sum + amount;
    }, 0);

    return {
      hasBalance: totalBalance >= requiredBalance,
      balance: totalBalance,
    };
  } catch (error) {
    console.error('Error checking token balance:', error);
    return { hasBalance: false, balance: 0 };
  }
}

export interface AuthResult {
  authenticated: boolean;
  verified: boolean;
  hasTokens: boolean;
  tokenBalance: number;
  error?: string;
}

/**
 * Full authentication check: verify signature + check token balance
 */
export async function authenticateUser(
  walletAddress: string,
  message: string,
  signature: string,
  options: {
    requireTokens?: boolean;
    mintAddress?: string;
    requiredBalance?: number;
    heliusApiKey?: string;
  } = {}
): Promise<AuthResult> {
  const {
    requireTokens = true,
    mintAddress,
    requiredBalance = REQUIRED_BALANCE,
    heliusApiKey,
  } = options;

  // Step 1: Verify signature
  const signatureValid = verifySignature(walletAddress, message, signature);
  if (!signatureValid) {
    return {
      authenticated: false,
      verified: false,
      hasTokens: false,
      tokenBalance: 0,
      error: 'Invalid signature. Please sign the message with your wallet.',
    };
  }

  // Step 2: Check message is recent (prevent replay attacks)
  if (!isMessageRecent(message)) {
    return {
      authenticated: false,
      verified: true,
      hasTokens: false,
      tokenBalance: 0,
      error: 'Signature expired. Please sign again.',
    };
  }

  // Step 3: Check token balance (if required)
  if (requireTokens && mintAddress) {
    const { hasBalance, balance } = await checkTokenBalance(
      walletAddress,
      mintAddress,
      requiredBalance,
      heliusApiKey
    );

    if (!hasBalance) {
      return {
        authenticated: false,
        verified: true,
        hasTokens: false,
        tokenBalance: balance,
        error: `Requires ${requiredBalance.toLocaleString()} $WHALESHIELD tokens. You have ${balance.toLocaleString()}.`,
      };
    }

    return {
      authenticated: true,
      verified: true,
      hasTokens: true,
      tokenBalance: balance,
    };
  }

  // No token requirement or no mint address set (pre-launch mode)
  return {
    authenticated: true,
    verified: true,
    hasTokens: !requireTokens,
    tokenBalance: 0,
  };
}

/**
 * Simplified auth - just verify signature (for voting, etc.)
 */
export function verifyWalletOwnership(
  walletAddress: string,
  message: string,
  signature: string
): { verified: boolean; error?: string } {
  const signatureValid = verifySignature(walletAddress, message, signature);

  if (!signatureValid) {
    return { verified: false, error: 'Invalid signature' };
  }

  if (!isMessageRecent(message)) {
    return { verified: false, error: 'Signature expired' };
  }

  return { verified: true };
}
