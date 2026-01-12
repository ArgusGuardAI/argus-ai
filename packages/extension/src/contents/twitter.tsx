import type { PlasmoCSConfig } from 'plasmo';
import '~/styles/globals.css';

export const config: PlasmoCSConfig = {
  matches: ['https://twitter.com/*', 'https://x.com/*'],
  run_at: 'document_idle',
};

// Twitter/X content script
// This will scan tweets for Solana token mentions and add WhaleShield badges

const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

function findTokenMentions(text: string): string[] {
  const matches = text.match(SOLANA_ADDRESS_REGEX) || [];
  // Filter to likely token addresses (basic validation)
  return matches.filter((addr) => addr.length >= 32 && addr.length <= 44);
}

function processtweet(tweetElement: Element) {
  // Skip if already processed
  if (tweetElement.hasAttribute('data-whaleshield-processed')) return;
  tweetElement.setAttribute('data-whaleshield-processed', 'true');

  const tweetText = tweetElement.textContent || '';
  const tokenAddresses = findTokenMentions(tweetText);

  if (tokenAddresses.length === 0) return;

  // Find links in tweet that might be pump.fun or dexscreener links
  const links = tweetElement.querySelectorAll('a[href*="pump.fun"], a[href*="dexscreener"]');

  links.forEach((link) => {
    // Add a small WhaleShield indicator next to the link
    const indicator = document.createElement('span');
    indicator.className = 'whaleshield-twitter-badge';
    indicator.innerHTML = '🐋🛡️';
    indicator.title = 'Click to check with WhaleShield';
    indicator.style.cssText = `
      cursor: pointer;
      margin-left: 4px;
      font-size: 14px;
    `;

    indicator.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Extract token from link
      const href = link.getAttribute('href') || '';
      const pumpMatch = href.match(/pump\.fun\/coin\/([A-Za-z0-9]+)/);
      const dexMatch = href.match(/dexscreener\.com\/solana\/([A-Za-z0-9]+)/);
      const tokenAddress = pumpMatch?.[1] || dexMatch?.[1];

      if (tokenAddress) {
        // Open pump.fun with WhaleShield active
        window.open(`https://pump.fun/coin/${tokenAddress}`, '_blank');
      }
    });

    link.parentNode?.insertBefore(indicator, link.nextSibling);
  });
}

// Process existing tweets
function processTweets() {
  const tweets = document.querySelectorAll('[data-testid="tweet"]');
  tweets.forEach(processtweet);
}

// Initial processing
setTimeout(processTweets, 2000);

// Observe for new tweets
const observer = new MutationObserver(() => {
  processTweets();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

export default function TwitterContent() {
  return null;
}
