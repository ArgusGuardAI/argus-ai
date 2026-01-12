import type { HoneypotRiskLevel } from '@whaleshield/shared';

interface RiskBadgeProps {
  riskLevel: HoneypotRiskLevel;
  riskScore: number;
  size?: 'sm' | 'md' | 'lg';
}

const riskConfig: Record<HoneypotRiskLevel, {
  gradient: string;
  glow: string;
  text: string;
  ringColor: string;
  bgGlow: string;
}> = {
  SAFE: {
    gradient: 'from-emerald-400 to-green-500',
    glow: '0 0 30px rgba(0, 255, 136, 0.5), 0 0 60px rgba(0, 255, 136, 0.2)',
    text: '#00ff88',
    ringColor: '#00ff88',
    bgGlow: 'rgba(0, 255, 136, 0.15)',
  },
  SUSPICIOUS: {
    gradient: 'from-yellow-400 to-amber-500',
    glow: '0 0 30px rgba(255, 204, 0, 0.5), 0 0 60px rgba(255, 204, 0, 0.2)',
    text: '#ffcc00',
    ringColor: '#ffcc00',
    bgGlow: 'rgba(255, 204, 0, 0.15)',
  },
  DANGEROUS: {
    gradient: 'from-orange-400 to-red-500',
    glow: '0 0 30px rgba(255, 107, 53, 0.5), 0 0 60px rgba(255, 107, 53, 0.2)',
    text: '#ff6b35',
    ringColor: '#ff6b35',
    bgGlow: 'rgba(255, 107, 53, 0.15)',
  },
  SCAM: {
    gradient: 'from-red-500 to-pink-600',
    glow: '0 0 30px rgba(255, 51, 102, 0.6), 0 0 60px rgba(255, 51, 102, 0.3)',
    text: '#ff3366',
    ringColor: '#ff3366',
    bgGlow: 'rgba(255, 51, 102, 0.2)',
  },
};

const sizes = {
  sm: { container: 'w-16 h-16', score: 'text-lg', label: 'text-[6px]', ring: 40, stroke: 4 },
  md: { container: 'w-20 h-20', score: 'text-2xl', label: 'text-[7px]', ring: 50, stroke: 5 },
  lg: { container: 'w-24 h-24', score: 'text-3xl', label: 'text-[8px]', ring: 60, stroke: 6 },
};

export function RiskBadge({ riskLevel, riskScore, size = 'md' }: RiskBadgeProps) {
  const config = riskConfig[riskLevel];
  const sizeConfig = sizes[size];

  const radius = (sizeConfig.ring - sizeConfig.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (riskScore / 100) * circumference;

  return (
    <div
      className={`relative ${sizeConfig.container} flex items-center justify-center`}
      style={{ filter: 'drop-shadow(0 0 10px rgba(0, 0, 0, 0.5))' }}
    >
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-full animate-pulse"
        style={{
          background: `radial-gradient(circle, ${config.bgGlow} 0%, transparent 70%)`,
        }}
      />

      {/* Hexagonal frame effect */}
      <div
        className="absolute inset-1 rounded-full"
        style={{
          background: 'linear-gradient(135deg, rgba(20, 20, 30, 0.9) 0%, rgba(5, 5, 10, 0.95) 100%)',
          border: `1px solid ${config.ringColor}30`,
        }}
      />

      {/* SVG Ring */}
      <svg
        className="absolute inset-0 -rotate-90"
        viewBox={`0 0 ${sizeConfig.ring} ${sizeConfig.ring}`}
      >
        {/* Background track */}
        <circle
          cx={sizeConfig.ring / 2}
          cy={sizeConfig.ring / 2}
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth={sizeConfig.stroke}
        />

        {/* Progress ring */}
        <circle
          cx={sizeConfig.ring / 2}
          cy={sizeConfig.ring / 2}
          r={radius}
          fill="none"
          stroke={config.ringColor}
          strokeWidth={sizeConfig.stroke}
          strokeLinecap="round"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset,
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            filter: `drop-shadow(0 0 6px ${config.ringColor})`,
          }}
        />

        {/* Tick marks */}
        {[0, 90, 180, 270].map((angle) => (
          <line
            key={angle}
            x1={sizeConfig.ring / 2}
            y1={2}
            x2={sizeConfig.ring / 2}
            y2={4}
            stroke={config.ringColor}
            strokeWidth={1}
            opacity={0.5}
            transform={`rotate(${angle} ${sizeConfig.ring / 2} ${sizeConfig.ring / 2})`}
          />
        ))}
      </svg>

      {/* Center content */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <span
          className={`font-cyber font-black ${sizeConfig.score} leading-none`}
          style={{
            color: config.text,
            textShadow: `0 0 20px ${config.text}80`,
          }}
        >
          {riskScore}
        </span>
        <span
          className={`font-cyber font-bold ${sizeConfig.label} tracking-widest mt-0.5`}
          style={{ color: config.text, opacity: 0.9 }}
        >
          {riskLevel}
        </span>
      </div>

      {/* Corner accents */}
      <svg className="absolute inset-0 pointer-events-none" viewBox="0 0 100 100">
        <path
          d="M 15 5 L 5 5 L 5 15"
          fill="none"
          stroke={config.ringColor}
          strokeWidth="1"
          opacity="0.4"
        />
        <path
          d="M 85 5 L 95 5 L 95 15"
          fill="none"
          stroke={config.ringColor}
          strokeWidth="1"
          opacity="0.4"
        />
        <path
          d="M 15 95 L 5 95 L 5 85"
          fill="none"
          stroke={config.ringColor}
          strokeWidth="1"
          opacity="0.4"
        />
        <path
          d="M 85 95 L 95 95 L 95 85"
          fill="none"
          stroke={config.ringColor}
          strokeWidth="1"
          opacity="0.4"
        />
      </svg>
    </div>
  );
}
