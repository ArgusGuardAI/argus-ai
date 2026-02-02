# Origin Vault

Isolated key management for Argus AI trading wallet. The first trading tool with cross-origin key isolation.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  app.argusguard.io (Main App)                                   │
│                                                                 │
│  ┌───────────────────┐     postMessage      ┌─────────────────┐│
│  │  tradingWallet.ts │ ◄──────────────────► │  Hidden iframe  ││
│  │  (VaultClient)    │                      │  to vault       ││
│  └───────────────────┘                      └─────────────────┘│
│                                                      │          │
│  - Creates unsigned transactions                     │          │
│  - Manages UI, positions, settings                   │          │
│  - NEVER sees private key                            │          │
└─────────────────────────────────────────────────────────────────┘
                                               Cross-Origin
                                                       │
┌─────────────────────────────────────────────────────────────────┐
│  secure.argusguard.io (Vault)                                   │
│                                                                 │
│  - Stores encrypted private key in localStorage                 │
│  - Signs transactions, returns signature only                   │
│  - Strict CSP: script-src 'self'                                │
│  - Zero third-party dependencies                                │
└─────────────────────────────────────────────────────────────────┘
```

## Security Properties

| Attack Vector | Protection |
|---------------|------------|
| Malicious browser extension | Cross-origin isolation prevents memory access |
| XSS on main app | Cannot execute code in vault context |
| Supply chain attack | Zero dependencies to compromise |
| Content script injection | Blocked by strict CSP headers |
| Clipboard hijacking | Private keys never leave encrypted storage |

## Message Protocol

The vault communicates with the main app via `postMessage`:

```typescript
// Supported operations
type VaultOperation =
  | 'create'    // Generate new keypair
  | 'import'    // Import existing keypair
  | 'sign'      // Sign transaction bytes
  | 'export'    // Export backup (requires confirmation)
  | 'delete'    // Delete permanently
  | 'getPublic' // Get public key only

// Verified origins only
const ALLOWED_ORIGINS = [
  'https://app.argusguard.io',
  'https://argusguard.io',
  'http://localhost:3000'
];
```

## Development

```bash
# Start vault dev server (port 3001)
pnpm dev

# The main app at localhost:3000 will connect automatically
```

## Deployment

```bash
# Build and deploy to Cloudflare Pages
pnpm build
npx wrangler pages deploy dist --project-name argusguard-vault
```

## Files

| File | Purpose |
|------|---------|
| `src/vault.ts` | Message handler, signing logic |
| `public/_headers` | CSP headers for Cloudflare Pages |
| `index.html` | Minimal HTML wrapper |

## Why Cross-Origin Isolation?

Traditional trading tools store private keys in the same origin as the app. This means:
- Browser extensions can read localStorage
- XSS vulnerabilities can steal keys
- Supply chain attacks can exfiltrate keys

By isolating the key on a separate domain:
- Extensions cannot cross the origin boundary
- XSS on app.argusguard.io cannot access secure.argusguard.io
- The vault has zero dependencies — nothing to compromise

This enables **fully autonomous trading** without wallet popups, while maintaining security that rivals hardware wallets.
