export const SOLANA_NETWORKS = {
  'mainnet-beta': {
    name: 'Mainnet Beta',
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    explorerUrl: 'https://explorer.solana.com',
  },
  devnet: {
    name: 'Devnet',
    rpcUrl: 'https://api.devnet.solana.com',
    explorerUrl: 'https://explorer.solana.com/?cluster=devnet',
  },
  testnet: {
    name: 'Testnet',
    rpcUrl: 'https://api.testnet.solana.com',
    explorerUrl: 'https://explorer.solana.com/?cluster=testnet',
  },
} as const;

export type SolanaNetwork = keyof typeof SOLANA_NETWORKS;

export const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';

export const DEX_PROGRAMS = {
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  RAYDIUM_CLMM: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  PUMP_FUN: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
} as const;

export const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';

// ArgusGuard Token Configuration
export const ARGUSGUARD_TOKEN = {
  mint: 'TBD_AFTER_LAUNCH', // Will be updated after Pump.fun launch
  symbol: '$ARGUSGUARD',
  decimals: 9,
  requiredBalance: 1000, // Minimum tokens required to unlock features
} as const;
