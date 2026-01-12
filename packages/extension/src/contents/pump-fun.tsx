import type { PlasmoCSConfig } from 'plasmo';
import { createRoot } from 'react-dom/client';
import { Paint } from '~/components/Paint';
import { PUMP_FUN_URL_PATTERN } from '@whaleshield/shared';
import '~/styles/globals.css';

export const config: PlasmoCSConfig = {
  matches: ['https://pump.fun/*'],
  run_at: 'document_idle',
};

// Extract token address from URL
function extractTokenAddress(): string | null {
  const match = window.location.href.match(PUMP_FUN_URL_PATTERN);
  return match ? match[1] : null;
}

// Find the token info container on pump.fun
function findTargetElement(): Element | null {
  // Try different selectors that pump.fun might use
  const selectors = [
    '[data-token-info]',
    '.token-header',
    '.coin-info',
    '.token-card-header',
    'main > div > div:first-child', // Generic fallback
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }

  return null;
}

// Track current React root for proper cleanup
let currentRoot: ReturnType<typeof createRoot> | null = null;
let currentTokenAddress: string | null = null;

// Remove overlay when not on a token page
function removeOverlay() {
  const existing = document.getElementById('whaleshield-paint-container');
  if (existing) {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    existing.remove();
    currentTokenAddress = null;
    console.log('[WhaleShield] Removed overlay (not on token page)');
  }
}

// Create and inject the overlay
function injectOverlay() {
  const tokenAddress = extractTokenAddress();

  // Not on a token page - remove overlay if it exists
  if (!tokenAddress) {
    removeOverlay();
    return;
  }

  const existingContainer = document.getElementById('whaleshield-paint-container');

  // If same token, don't re-inject
  if (existingContainer && currentTokenAddress === tokenAddress) {
    return;
  }

  // If different token, unmount old React root and remove container
  if (existingContainer) {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    existingContainer.remove();
  }

  const target = findTargetElement();
  if (!target) {
    console.log('[WhaleShield] Target element not found, will retry...');
    return;
  }

  // Create container
  const container = document.createElement('div');
  container.id = 'whaleshield-paint-container';
  container.style.cssText = `
    margin: 16px 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;

  // Insert after the target element
  target.parentNode?.insertBefore(container, target.nextSibling);

  // Mount React with key to force fresh state
  currentRoot = createRoot(container);
  currentRoot.render(<Paint key={tokenAddress} tokenAddress={tokenAddress} />);
  currentTokenAddress = tokenAddress;

  console.log(`[WhaleShield] Injected overlay for token: ${tokenAddress}`);
}

// Initial injection
setTimeout(injectOverlay, 1000);

// Observe for SPA navigation
const observer = new MutationObserver(() => {
  const tokenAddress = extractTokenAddress();
  const existing = document.getElementById('whaleshield-paint-container');

  // Not on token page - remove overlay
  if (!tokenAddress && existing) {
    removeOverlay();
    return;
  }

  // If we have a token and container was removed by pump.fun, re-inject
  if (tokenAddress && !existing) {
    currentRoot = null;
    currentTokenAddress = null;
    injectOverlay();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Re-inject on URL changes (SPA navigation)
let lastUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    // Force re-injection for new token
    injectOverlay();
  }
}, 300);

export default function PumpFunContent() {
  return null;
}
