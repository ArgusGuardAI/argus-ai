import type { HoneypotFlag } from '@argusguard/shared';

interface ThreatCardsProps {
  flags: HoneypotFlag[];
}

interface MetricCard {
  icon: string;
  label: string;
  value: string;
  subValue?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Parse flags into visual metric cards
function parseFlags(flags: HoneypotFlag[]): MetricCard[] {
  const cards: MetricCard[] = [];
  const seenTypes = new Set<string>();

  for (const flag of flags) {
    const severity = flag.severity.toLowerCase() as MetricCard['severity'];
    const msg = flag.message;

    // Map various flag types to consistent categories
    const typeKey = flag.type.toUpperCase();

    // Skip duplicate types
    if (seenTypes.has(typeKey)) continue;
    seenTypes.add(typeKey);

    // TOKEN AGE / CONTRACT flags
    if (typeKey === 'CONTRACT' || typeKey === 'TOKEN_AGE' || msg.toLowerCase().includes('new') && msg.toLowerCase().includes('day')) {
      const ageMatch = msg.match(/<?\s*(\d+)\s*(day|hour|minute|week)/i) || msg.match(/(\d+)\s*(day|hour)/i);
      const priceMatch = msg.match(/([+-]?[\d,.]+)%/);
      cards.push({
        icon: '⏱️',
        label: 'TOKEN AGE',
        value: ageMatch ? `${ageMatch[1]} ${ageMatch[2]}${parseInt(ageMatch[1]) !== 1 ? 's' : ''}` : '<1 day',
        subValue: priceMatch ? `${priceMatch[1]}% 24h` : undefined,
        severity,
      });
      continue;
    }

    // HOLDER / OWNERSHIP flags
    if (typeKey === 'OWNERSHIP' || typeKey === 'HOLDER_CONCENTRATION' || typeKey === 'HOLDERS') {
      // Match patterns like "top 1 holder concentration (5.15%)" or "top 1: 5.15%"
      const top1Match = msg.match(/top\s*1[^(]*\(?([\d.]+)%\)?/i) || msg.match(/single[^(]*\(?([\d.]+)%/i);
      const top10Match = msg.match(/top\s*10[^(]*\(?([\d.]+)%\)?/i);
      const holdersMatch = msg.match(/(\d+)\s*holders?/i);
      cards.push({
        icon: '👥',
        label: 'HOLDERS',
        value: top1Match ? `Top1: ${parseFloat(top1Match[1]).toFixed(1)}%` : (holdersMatch ? `${holdersMatch[1]} holders` : 'Distributed'),
        subValue: top10Match ? `Top10: ${parseFloat(top10Match[1]).toFixed(1)}%` : (holdersMatch && top1Match ? `${holdersMatch[1]} holders` : undefined),
        severity,
      });
      continue;
    }

    // DEPLOYER flags
    if (typeKey === 'DEPLOYER' || typeKey === 'DEPLOYER_INFO') {
      // Match "0 days wallet age" or "wallet age: 0 days" patterns
      const walletAgeMatch = msg.match(/(\d+)\s*days?\s*wallet/i) || msg.match(/wallet age[:\s]*(\d+)/i) || msg.match(/(\d+)\s*days?\s*old/i);
      const unknownMatch = msg.toLowerCase().includes('unknown');
      cards.push({
        icon: '👤',
        label: 'DEPLOYER',
        value: unknownMatch ? 'Unknown' : 'Known',
        subValue: walletAgeMatch ? `${walletAgeMatch[1]} days old` : 'New wallet',
        severity,
      });
      continue;
    }

    // LIQUIDITY flags - only if explicitly about liquidity
    if (typeKey === 'LIQUIDITY') {
      const liqMatch = msg.match(/liquidity[^$]*\$([\d,.]+[KMB]?)/i) || msg.match(/\$([\d,.]+[KMB]?)\s*liquidity/i);
      const mcMatch = msg.match(/market\s*cap[^$]*\$([\d,.]+[KMB]?)/i);
      cards.push({
        icon: '💧',
        label: 'LIQUIDITY',
        value: liqMatch ? `$${liqMatch[1]}` : 'Low',
        subValue: mcMatch ? `MC: $${mcMatch[1]}` : undefined,
        severity,
      });
      continue;
    }

    // TRADING flags - price change and volume
    if (typeKey === 'TRADING' || typeKey === 'TRADING_PATTERNS') {
      const priceChangeMatch = msg.match(/([+-]?[\d,.]+)%/);
      const volumeMatch = msg.match(/volume[^$]*\$([\d,.]+[KMB]?)/i) || msg.match(/\$([\d,.]+[KMB]?)\s*volume/i);
      const buysMatch = msg.match(/([\d,]+)\s*buys?/i);
      const sellsMatch = msg.match(/([\d,]+)\s*sells?/i);

      if (priceChangeMatch || volumeMatch) {
        cards.push({
          icon: '📈',
          label: '24H CHANGE',
          value: priceChangeMatch ? `${priceChangeMatch[1]}%` : 'N/A',
          subValue: volumeMatch ? `Vol: $${volumeMatch[1]}` : (buysMatch ? `${buysMatch[1]} buys` : undefined),
          severity,
        });
        continue;
      }

      if (buysMatch || sellsMatch) {
        cards.push({
          icon: '📊',
          label: 'VOLUME 24H',
          value: buysMatch ? `${buysMatch[1]} buys` : 'Low',
          subValue: sellsMatch ? `${sellsMatch[1]} sells` : undefined,
          severity,
        });
        continue;
      }
    }

    // SOCIAL flags - team, community info
    if (typeKey === 'SOCIAL') {
      const hasTwitter = msg.toLowerCase().includes('twitter');
      const hasTelegram = msg.toLowerCase().includes('telegram');
      const unknownTeam = msg.toLowerCase().includes('unknown team');
      cards.push({
        icon: '🐦',
        label: 'SOCIAL',
        value: hasTwitter ? 'Twitter ✓' : (hasTelegram ? 'Telegram ✓' : 'None'),
        subValue: unknownTeam ? 'Unknown team' : undefined,
        severity,
      });
      continue;
    }

    // Fallback: create a generic card
    cards.push({
      icon: getIconForType(typeKey),
      label: formatLabel(typeKey),
      value: extractKeyValue(msg),
      subValue: extractSubValue(msg),
      severity,
    });
  }

  return cards;
}

function getIconForType(type: string): string {
  const icons: Record<string, string> = {
    'CONTRACT': '📜',
    'TOKEN_AGE': '⏱️',
    'OWNERSHIP': '👥',
    'HOLDER_CONCENTRATION': '👥',
    'HOLDERS': '👥',
    'DEPLOYER': '👤',
    'DEPLOYER_INFO': '👤',
    'LIQUIDITY': '💧',
    'SOCIAL': '📊',
    'TRADING': '📊',
    'TRADING_PATTERNS': '📊',
    'BUNDLE': '🔗',
  };
  return icons[type] || '⚠️';
}

function formatLabel(type: string): string {
  return type.replace(/_/g, ' ').slice(0, 12);
}

function extractKeyValue(msg: string): string {
  // Try to extract a key numeric value
  const percentMatch = msg.match(/([\d.]+)%/);
  if (percentMatch) return `${percentMatch[1]}%`;

  const dollarMatch = msg.match(/\$([\d,.]+[KMB]?)/i);
  if (dollarMatch) return `$${dollarMatch[1]}`;

  const numberMatch = msg.match(/(\d+(?:,\d+)*)/);
  if (numberMatch) return numberMatch[1];

  // Return first 20 chars if no number found
  return msg.slice(0, 20) + (msg.length > 20 ? '...' : '');
}

function extractSubValue(msg: string): string | undefined {
  // Look for secondary info after comma or dash
  const parts = msg.split(/[,\-–]/);
  if (parts.length > 1) {
    const secondary = parts[1].trim().slice(0, 25);
    return secondary.length > 0 ? secondary : undefined;
  }
  return undefined;
}

const severityColors = {
  low: {
    bg: 'rgba(0, 255, 136, 0.08)',
    border: 'rgba(0, 255, 136, 0.25)',
    text: '#00ff88',
  },
  medium: {
    bg: 'rgba(255, 204, 0, 0.08)',
    border: 'rgba(255, 204, 0, 0.25)',
    text: '#ffcc00',
  },
  high: {
    bg: 'rgba(255, 107, 53, 0.08)',
    border: 'rgba(255, 107, 53, 0.25)',
    text: '#ff6b35',
  },
  critical: {
    bg: 'rgba(255, 51, 102, 0.1)',
    border: 'rgba(255, 51, 102, 0.3)',
    text: '#ff3366',
  },
};

export function ThreatCards({ flags }: ThreatCardsProps) {
  const cards = parseFlags(flags);

  if (cards.length === 0) {
    return (
      <div className="text-center py-4 text-gray-500 text-xs">
        No threat indicators detected
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {cards.map((card, i) => {
        const colors = severityColors[card.severity];
        return (
          <div
            key={i}
            className="rounded-xl p-3 relative overflow-hidden"
            style={{
              background: colors.bg,
              border: `1px solid ${colors.border}`,
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">{card.icon}</span>
              <span
                className="text-[9px] font-cyber tracking-wider uppercase"
                style={{ color: colors.text, opacity: 0.9 }}
              >
                {card.label}
              </span>
              {/* Severity dot */}
              <div
                className="ml-auto w-2 h-2 rounded-full"
                style={{
                  background: colors.text,
                  boxShadow: `0 0 6px ${colors.text}`,
                }}
              />
            </div>

            {/* Main Value */}
            <div
              className="text-sm font-bold font-mono leading-tight truncate"
              style={{ color: colors.text }}
              title={card.value}
            >
              {card.value}
            </div>

            {/* Sub value */}
            {card.subValue && (
              <div className="text-[10px] text-gray-400 mt-1 font-mono truncate" title={card.subValue}>
                {card.subValue}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
