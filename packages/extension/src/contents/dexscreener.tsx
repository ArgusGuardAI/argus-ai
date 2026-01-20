import type { PlasmoCSConfig } from 'plasmo';
import { createRoot } from 'react-dom/client';
import { Paint } from '~/components/Paint';
import '~/styles/globals.css';

export const config: PlasmoCSConfig = {
  matches: ['https://dexscreener.com/solana/*'],
  run_at: 'document_idle',
};

// Extract pair address from URL (DexScreener uses pair addresses, not token addresses)
function extractPairAddress(): string | null {
  const pathMatch = window.location.pathname.match(/\/solana\/([A-Za-z0-9]+)/i);
  if (pathMatch) {
    return pathMatch[1];
  }
  return null;
}

// Fetch actual token address from DexScreener API using pair address
async function fetchTokenAddress(pairAddress: string): Promise<string | null> {
  try {
    console.log('[ArgusGuard] Fetching token for pair:', pairAddress);
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`
    );

    if (!response.ok) {
      console.log('[ArgusGuard] DexScreener API failed:', response.status);
      return null;
    }

    const data = await response.json();
    const tokenAddress = data?.pair?.baseToken?.address;

    if (tokenAddress) {
      console.log('[ArgusGuard] Got token address:', tokenAddress);
      return tokenAddress;
    }

    return null;
  } catch (error) {
    console.error('[ArgusGuard] Error fetching token address:', error);
    return null;
  }
}

// Find the main chart container to inject above it (full width)
function findTargetElement(): Element | null {
  // Strategy: Find the main content area that contains the chart
  // We want to inject above it, pushing the chart down

  // Look for the TradingView chart container or main chart area
  const chartSelectors = [
    // TradingView container
    '.tv-lightweight-charts',
    '[class*="tradingview"]',
    // Chart wrapper
    '[class*="chart"]',
    // Main content area (center column)
    '[class*="custom-697dix"]',
    '[class*="custom-10cx1kp"]',
  ];

  for (const selector of chartSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      console.log(`[ArgusGuard] Found chart element: ${selector}`);
      // Return the parent to inject before the chart container
      return element;
    }
  }

  // Fallback: Look for the main center content area
  // DexScreener layout: left nav | center chart | right info
  const mainContent = document.querySelector('main') ||
                      document.querySelector('[role="main"]');

  if (mainContent) {
    // Find a child that looks like the chart area (has significant height)
    const children = mainContent.querySelectorAll(':scope > div');
    for (const child of children) {
      if (child.querySelector('canvas') || child.querySelector('iframe')) {
        console.log('[ArgusGuard] Found chart via canvas/iframe');
        return child;
      }
    }
  }

  // Last resort: find the element containing the timeframe buttons (1m, 5m, etc)
  const timeframeBar = document.querySelector('[class*="custom-"][class*="flex"]');
  if (timeframeBar && timeframeBar.textContent?.includes('1m')) {
    console.log('[ArgusGuard] Found via timeframe bar');
    return timeframeBar.parentElement;
  }

  return null;
}

// Track current React root for proper cleanup
let currentRoot: ReturnType<typeof createRoot> | null = null;
let currentTokenAddress: string | null = null;

// Remove overlay when not on a token page
function removeOverlay() {
  const existing = document.getElementById('argusguard-paint-container');
  if (existing) {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    existing.remove();
    currentTokenAddress = null;
    console.log('[ArgusGuard] Removed overlay (not on token page)');
  }
}

// Track current pair address to detect navigation
let currentPairAddress: string | null = null;
let isLoading = false;

// Create and inject the overlay
async function injectOverlay() {
  const pairAddress = extractPairAddress();

  // Not on a token page - remove overlay if it exists
  if (!pairAddress) {
    removeOverlay();
    currentPairAddress = null;
    return;
  }

  const existingContainer = document.getElementById('argusguard-paint-container');

  // If same pair, don't re-inject
  if (existingContainer && currentPairAddress === pairAddress) {
    return;
  }

  // Prevent multiple simultaneous loads
  if (isLoading) return;
  isLoading = true;

  // If different pair, unmount old React root and remove container
  if (existingContainer) {
    if (currentRoot) {
      currentRoot.unmount();
      currentRoot = null;
    }
    existingContainer.remove();
  }

  // Fetch the actual token address from DexScreener API
  const tokenAddress = await fetchTokenAddress(pairAddress);

  if (!tokenAddress) {
    console.log('[ArgusGuard] Could not get token address for pair:', pairAddress);
    isLoading = false;
    return;
  }

  // Find target element to inject before
  const target = findTargetElement();
  if (!target) {
    console.log('[ArgusGuard] Target element not found on DexScreener, will retry...');
    isLoading = false;
    return;
  }

  // Create container - full width above chart
  const container = document.createElement('div');
  container.id = 'argusguard-paint-container';
  container.style.cssText = `
    width: 100%;
    padding: 12px 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-sizing: border-box;
    background: rgba(10, 10, 15, 0.95);
    border-bottom: 1px solid rgba(0, 212, 255, 0.2);
  `;

  // Insert before the target element (pushes chart down)
  target.parentNode?.insertBefore(container, target);
  console.log('[ArgusGuard] Container injected above chart');

  // Mount React with key to force fresh state
  currentRoot = createRoot(container);
  currentRoot.render(<Paint key={tokenAddress} tokenAddress={tokenAddress} />);
  currentTokenAddress = tokenAddress;
  currentPairAddress = pairAddress;
  isLoading = false;

  console.log(`[ArgusGuard] Injected overlay for token: ${tokenAddress} (pair: ${pairAddress})`);
}

// Initial injection (wait longer for DexScreener's heavy React app)
setTimeout(injectOverlay, 1500);

// Observe for SPA navigation
const observer = new MutationObserver(() => {
  const pairAddress = extractPairAddress();
  const existing = document.getElementById('argusguard-paint-container');

  // Not on token page - remove overlay
  if (!pairAddress && existing) {
    removeOverlay();
    currentPairAddress = null;
    return;
  }

  // If we have a pair and container was removed, re-inject
  if (pairAddress && !existing) {
    currentRoot = null;
    currentTokenAddress = null;
    currentPairAddress = null;
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

export default function DexScreenerContent() {
  return null;
}
