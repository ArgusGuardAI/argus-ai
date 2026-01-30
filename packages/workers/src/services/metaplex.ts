/**
 * Metaplex Metadata Parser
 *
 * Fetches token metadata from Metaplex Token Metadata Program.
 * Derives PDAs and parses on-chain metadata accounts.
 */

import { SolanaRpcClient } from './solana-rpc';

// Metaplex Token Metadata Program ID
const METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

export interface TokenMetadata {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  updateAuthority: string;
  primarySaleHappened: boolean;
  isMutable: boolean;
  creators?: Array<{
    address: string;
    verified: boolean;
    share: number;
  }>;
}

/**
 * Derive the metadata PDA for a token mint
 */
export function deriveMetadataPDA(mint: string): string {
  // PDA = findProgramAddress([
  //   "metadata",
  //   METADATA_PROGRAM_ID,
  //   mint
  // ], METADATA_PROGRAM_ID)

  // For Cloudflare Workers, we can't use @solana/web3.js directly
  // Instead, we'll compute the PDA manually using the seed derivation algorithm

  // This is a simplified approach - we'll try common PDA patterns
  // In production, you'd want to use the full PDA derivation

  // For now, return a placeholder that will be resolved by searching program accounts
  return `metadata_${mint}`;
}

/**
 * Fetch token metadata from Metaplex
 */
export async function fetchTokenMetadata(
  rpc: SolanaRpcClient,
  mint: string
): Promise<TokenMetadata | null> {
  try {
    // Method 1: Search program accounts for this mint's metadata
    // The metadata account stores the mint at a specific offset
    const accounts = await rpc.getProgramAccounts(METADATA_PROGRAM_ID, [
      {
        memcmp: {
          offset: 33, // Mint pubkey starts at offset 33 in metadata account
          bytes: mint,
        },
      },
    ]);

    if (accounts.length === 0) {
      console.log(`[Metaplex] No metadata found for ${mint.slice(0, 8)}...`);
      return null;
    }

    // Parse the first matching metadata account
    const metadataAccount = accounts[0];
    const accountInfo = await rpc.getAccountInfo(metadataAccount.pubkey, 'base64');

    if (!accountInfo.value) return null;

    // Decode base64 data
    const data = accountInfo.value.data as [string, string];
    const buffer = Buffer.from(data[0], 'base64');

    return parseMetadataAccount(buffer, mint);
  } catch (err) {
    console.warn('[Metaplex] Error fetching metadata:', err);
    return null;
  }
}

/**
 * Parse a Metaplex metadata account buffer
 *
 * Account layout:
 * - 1 byte: key (4 = MetadataV1)
 * - 32 bytes: update authority
 * - 32 bytes: mint
 * - 4 bytes: name length prefix
 * - variable: name (padded to 32 bytes typical)
 * - 4 bytes: symbol length prefix
 * - variable: symbol (padded to 10 bytes typical)
 * - 4 bytes: uri length prefix
 * - variable: uri (padded to 200 bytes typical)
 * - ... additional fields
 */
function parseMetadataAccount(buffer: Buffer, _expectedMint: string): TokenMetadata | null {
  try {
    let offset = 0;

    // Key (1 byte) - should be 4 for MetadataV1
    const key = buffer.readUInt8(offset);
    offset += 1;

    if (key !== 4) {
      console.warn(`[Metaplex] Unexpected key: ${key}`);
      // Continue anyway, might be different version
    }

    // Update authority (32 bytes)
    const updateAuthority = readPubkeyFromBuffer(buffer, offset);
    offset += 32;

    // Mint (32 bytes)
    const mint = readPubkeyFromBuffer(buffer, offset);
    offset += 32;

    // Name (4 byte length + string)
    const nameLength = buffer.readUInt32LE(offset);
    offset += 4;
    const name = buffer.slice(offset, offset + Math.min(nameLength, 32)).toString('utf8').replace(/\0/g, '').trim();
    offset += 32; // Fixed padding

    // Symbol (4 byte length + string)
    const symbolLength = buffer.readUInt32LE(offset);
    offset += 4;
    const symbol = buffer.slice(offset, offset + Math.min(symbolLength, 10)).toString('utf8').replace(/\0/g, '').trim();
    offset += 10; // Fixed padding

    // URI (4 byte length + string)
    const uriLength = buffer.readUInt32LE(offset);
    offset += 4;
    const uri = buffer.slice(offset, offset + Math.min(uriLength, 200)).toString('utf8').replace(/\0/g, '').trim();
    offset += 200; // Fixed padding

    // Seller fee basis points (2 bytes) - skip for now
    offset += 2;

    // Creators (optional)
    const hasCreators = buffer.readUInt8(offset) === 1;
    offset += 1;

    let creators: TokenMetadata['creators'];
    if (hasCreators) {
      const creatorCount = buffer.readUInt32LE(offset);
      offset += 4;

      creators = [];
      for (let i = 0; i < Math.min(creatorCount, 5); i++) {
        const creatorAddress = readPubkeyFromBuffer(buffer, offset);
        offset += 32;
        const verified = buffer.readUInt8(offset) === 1;
        offset += 1;
        const share = buffer.readUInt8(offset);
        offset += 1;

        creators.push({ address: creatorAddress, verified, share });
      }
    }

    // Primary sale happened
    const primarySaleHappened = buffer.readUInt8(offset) === 1;
    offset += 1;

    // Is mutable
    const isMutable = buffer.readUInt8(offset) === 1;

    return {
      mint,
      name: name || 'Unknown',
      symbol: symbol || '???',
      uri,
      updateAuthority,
      primarySaleHappened,
      isMutable,
      creators,
    };
  } catch (err) {
    console.warn('[Metaplex] Error parsing metadata:', err);
    return null;
  }
}

/**
 * Read a base58-encoded pubkey from buffer
 */
function readPubkeyFromBuffer(buffer: Buffer, offset: number): string {
  const bytes = buffer.slice(offset, offset + 32);
  return encodeBase58(bytes);
}

/**
 * Base58 encoding
 */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function encodeBase58(bytes: Buffer): string {
  if (bytes.length === 0) return '';

  // Convert to big integer
  let num = BigInt('0x' + bytes.toString('hex'));

  let result = '';
  while (num > 0n) {
    const mod = Number(num % 58n);
    result = BASE58_ALPHABET[mod] + result;
    num = num / 58n;
  }

  // Add leading zeros
  for (const byte of bytes) {
    if (byte === 0) {
      result = '1' + result;
    } else {
      break;
    }
  }

  return result;
}

/**
 * Fetch off-chain metadata from URI
 */
export async function fetchOffChainMetadata(uri: string): Promise<{
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
} | null> {
  if (!uri || uri.length === 0) return null;

  try {
    // Handle IPFS URIs
    let fetchUri = uri;
    if (uri.startsWith('ipfs://')) {
      fetchUri = `https://ipfs.io/ipfs/${uri.slice(7)}`;
    }

    const response = await fetch(fetchUri, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      name?: string;
      symbol?: string;
      description?: string;
      image?: string;
      attributes?: Array<{ trait_type: string; value: string }>;
    };

    return data;
  } catch {
    return null;
  }
}
