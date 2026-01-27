/**
 * Telegram Bot API Service
 * Send messages, handle webhooks, format alerts
 */

const TELEGRAM_API = 'https://api.telegram.org/bot';

// ============================================
// Core API Methods
// ============================================

export async function sendMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
  disablePreview = false
): Promise<{ ok: boolean; messageId?: number; error?: string }> {
  try {
    const response = await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: disablePreview,
      }),
    });

    const data = (await response.json()) as {
      ok: boolean;
      result?: { message_id: number };
      description?: string;
    };

    if (data.ok && data.result) {
      return { ok: true, messageId: data.result.message_id };
    }

    console.error(`[Telegram] sendMessage error: ${data.description}`);
    return { ok: false, error: data.description || 'Unknown error' };
  } catch (error) {
    console.error('[Telegram] sendMessage failed:', error);
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function setWebhook(
  botToken: string,
  webhookUrl: string
): Promise<{ ok: boolean; description?: string }> {
  const response = await fetch(`${TELEGRAM_API}${botToken}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });

  return (await response.json()) as { ok: boolean; description?: string };
}

export async function deleteWebhook(botToken: string): Promise<{ ok: boolean }> {
  const response = await fetch(`${TELEGRAM_API}${botToken}/deleteWebhook`, {
    method: 'POST',
  });
  return (await response.json()) as { ok: boolean };
}

export async function getMe(botToken: string): Promise<{ ok: boolean; result?: { username: string; first_name: string } }> {
  const response = await fetch(`${TELEGRAM_API}${botToken}/getMe`);
  return (await response.json()) as { ok: boolean; result?: { username: string; first_name: string } };
}

// ============================================
// Webhook Update Types
// ============================================

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
}

// ============================================
// Alert Formatting (HTML)
// ============================================

interface AlertData {
  tokenAddress: string;
  name: string;
  symbol: string;
  riskScore: number;
  riskLevel: string;
  liquidity: number;
  marketCap: number;
  ageHours: number;
  bundleDetected: boolean;
  bundleCount: number;
  bundleConfidence: string;
  flags: Array<{ type: string; severity: string; message: string }>;
  summary: string;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toFixed(0);
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function getSignalLabel(riskScore: number): string {
  const display = 100 - riskScore;
  if (display >= 75) return 'STRONG BUY';
  if (display >= 60) return 'BUY';
  if (display >= 45) return 'WATCH';
  if (display >= 30) return 'HOLD';
  return 'AVOID';
}

export function formatAlertHtml(data: AlertData): string {
  const displayScore = 100 - data.riskScore;
  const signal = getSignalLabel(data.riskScore);

  let alertType = 'RISK ALERT';
  if (data.bundleDetected) alertType = 'BUNDLE ALERT';
  if (data.riskScore >= 80) alertType = 'SCAM ALERT';

  const lines: string[] = [];

  lines.push(`\u{1F6A8} <b>${alertType}: $${escapeHtml(data.symbol)}</b>`);
  lines.push(`<i>${escapeHtml(data.name)}</i>`);
  lines.push('');

  lines.push(`\u{26A0}\u{FE0F} <b>Safety: ${displayScore}/100 (${signal})</b>`);

  if (data.bundleDetected) {
    lines.push(`\u{1F578}\u{FE0F} ${data.bundleCount} coordinated wallets (${data.bundleConfidence})`);
  }

  const marketParts: string[] = [];
  if (data.liquidity > 0) marketParts.push(`Liq: $${formatNumber(data.liquidity)}`);
  if (data.marketCap > 0) marketParts.push(`MCap: $${formatNumber(data.marketCap)}`);
  if (marketParts.length > 0) {
    lines.push(`\u{1F4B0} ${marketParts.join(' | ')}`);
  }

  if (data.ageHours !== undefined) {
    lines.push(`\u{23F0} ${formatAge(data.ageHours)} old`);
  }

  // Show top flags
  const criticalFlags = data.flags.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  for (const flag of criticalFlags.slice(0, 3)) {
    lines.push(`\u{1F534} ${escapeHtml(flag.message)}`);
  }

  lines.push('');
  lines.push(`\u{1F50D} <a href="https://app.argusguard.io/?token=${data.tokenAddress}">View Full Analysis</a>`);
  lines.push('');
  lines.push('#Solana #RugPull #DYOR');

  return lines.join('\n');
}

// ============================================
// Interactive Analysis Response (HTML)
// ============================================

interface AnalysisResult {
  tokenInfo: {
    name: string;
    symbol: string;
    address: string;
    price?: number;
    marketCap?: number;
    liquidity?: number;
    ageHours?: number;
    holderCount?: number;
    volume24h?: number;
  };
  analysis: {
    riskScore: number;
    riskLevel: string;
    summary: string;
    recommendation: string;
    flags: Array<{ type: string; severity: string; message: string }>;
  };
  bundleInfo?: { detected: boolean; count: number; confidence: string };
  devActivity?: { hasSold: boolean; percentSold: number; currentHoldingsPercent: number };
  creatorInfo?: { address: string; currentHoldings: number };
}

export function formatAnalysisHtml(result: AnalysisResult): string {
  const { tokenInfo, analysis, bundleInfo, devActivity, creatorInfo } = result;
  const displayScore = 100 - analysis.riskScore;
  const signal = getSignalLabel(analysis.riskScore);

  // Score bar visualization
  let scoreEmoji = '\u{1F7E2}'; // green
  if (displayScore < 30) scoreEmoji = '\u{1F534}'; // red
  else if (displayScore < 45) scoreEmoji = '\u{1F7E0}'; // orange
  else if (displayScore < 60) scoreEmoji = '\u{1F7E1}'; // yellow

  const lines: string[] = [];

  lines.push(`${scoreEmoji} <b>${escapeHtml(tokenInfo.name)} ($${escapeHtml(tokenInfo.symbol)})</b>`);
  lines.push('');

  // Score
  lines.push(`<b>Safety Score: ${displayScore}/100 (${signal})</b>`);
  lines.push(`Risk Level: ${analysis.riskLevel}`);
  lines.push('');

  // Market data
  lines.push(`\u{1F4CA} <b>Market Data</b>`);
  if (tokenInfo.price) lines.push(`Price: $${tokenInfo.price < 0.01 ? tokenInfo.price.toExponential(2) : tokenInfo.price.toFixed(4)}`);
  if (tokenInfo.marketCap) lines.push(`Market Cap: $${formatNumber(tokenInfo.marketCap)}`);
  if (tokenInfo.liquidity) lines.push(`Liquidity: $${formatNumber(tokenInfo.liquidity)}`);
  if (tokenInfo.volume24h) lines.push(`24h Volume: $${formatNumber(tokenInfo.volume24h)}`);
  if (tokenInfo.ageHours !== undefined) lines.push(`Age: ${formatAge(tokenInfo.ageHours)}`);
  if (tokenInfo.holderCount) lines.push(`Holders: ${tokenInfo.holderCount}`);
  lines.push('');

  // Bundle info
  if (bundleInfo?.detected) {
    lines.push(`\u{1F578}\u{FE0F} <b>Bundle Detected</b>`);
    lines.push(`${bundleInfo.count} coordinated wallets (${bundleInfo.confidence} confidence)`);
    lines.push('');
  }

  // Dev activity
  if (devActivity && creatorInfo) {
    lines.push(`\u{1F464} <b>Developer</b>`);
    lines.push(`Holdings: ${devActivity.currentHoldingsPercent.toFixed(1)}%`);
    if (devActivity.hasSold) {
      lines.push(`Sold: ${devActivity.percentSold.toFixed(1)}%`);
    }
    lines.push('');
  }

  // Flags
  if (analysis.flags.length > 0) {
    lines.push(`\u{1F6A9} <b>Risk Flags</b>`);
    for (const flag of analysis.flags.slice(0, 5)) {
      const icon = flag.severity === 'CRITICAL' ? '\u{1F534}' : flag.severity === 'HIGH' ? '\u{1F7E0}' : '\u{1F7E1}';
      lines.push(`${icon} ${escapeHtml(flag.message)}`);
    }
    lines.push('');
  }

  // Summary
  lines.push(`\u{1F4DD} <b>Summary</b>`);
  lines.push(escapeHtml(analysis.summary));
  lines.push('');

  // Link
  lines.push(`\u{1F50D} <a href="https://app.argusguard.io/?token=${tokenInfo.address}">View on Argus</a>`);

  return lines.join('\n');
}

// ============================================
// Help / Welcome Message
// ============================================

export function formatHelpHtml(): string {
  return [
    `\u{1F6E1}\u{FE0F} <b>Argus AI — Token Security Scanner</b>`,
    '',
    'Send me any Solana token address and I\'ll analyze it for:',
    '',
    '\u{1F578}\u{FE0F} Bundle attacks (coordinated wallets)',
    '\u{1F4C9} Rug pull risk',
    '\u{1F464} Developer selling activity',
    '\u{1F4CA} Market data &amp; liquidity',
    '\u{26A0}\u{FE0F} Honeypot detection',
    '',
    '<b>How to use:</b>',
    'Just paste a token mint address like:',
    '<code>FFKCBAX1b38kxsTsveBn6CtkXwShs3FHBAUeM1fZpump</code>',
    '',
    '<b>Commands:</b>',
    '/start — Show this help message',
    '/help — Show this help message',
    '',
    `\u{1F310} <a href="https://argusguard.io">Website</a> | <a href="https://x.com/ArgusPanoptes7z">Twitter</a>`,
  ].join('\n');
}

// ============================================
// Helpers
// ============================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Check if a string looks like a Solana address (base58, 32-44 chars)
 */
export function isSolanaAddress(text: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(text.trim());
}
