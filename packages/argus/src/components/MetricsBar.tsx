/**
 * MetricsBar Component
 *
 * Glassmorphism metrics cards showing key dashboard statistics.
 * Part of the AI Command Center design.
 */

import React from 'react';

interface MetricsBarProps {
  stats: {
    scansToday: number;
    scansTotal: number;
    alertsToday: number;
    highRiskAlerts: number;
    graduationsToday: number;
    graduationsTotal: number;
  } | null;
  isLoading?: boolean;
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  color: 'emerald' | 'amber' | 'red' | 'blue' | 'purple';
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon,
  label,
  value,
  subValue,
  color,
}) => {
  const colorClasses = {
    emerald: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/30 text-emerald-400',
    amber: 'from-amber-500/20 to-amber-600/5 border-amber-500/30 text-amber-400',
    red: 'from-red-500/20 to-red-600/5 border-red-500/30 text-red-400',
    blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/30 text-blue-400',
    purple: 'from-purple-500/20 to-purple-600/5 border-purple-500/30 text-purple-400',
  };

  const iconColors = {
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  };

  return (
    <div
      className={`
        relative overflow-hidden rounded-xl
        bg-gradient-to-br ${colorClasses[color]}
        backdrop-blur-xl border
        p-4 transition-all duration-300
        hover:scale-[1.02] hover:shadow-lg hover:shadow-${color}-500/10
      `}
    >
      {/* Glow effect */}
      <div className={`absolute -top-10 -right-10 w-24 h-24 bg-${color}-500/10 rounded-full blur-2xl`} />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1">
            {label}
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          {subValue && (
            <p className="text-xs text-zinc-500 mt-1">
              {subValue}
            </p>
          )}
        </div>
        <div className={`${iconColors[color]} opacity-80`}>
          {icon}
        </div>
      </div>
    </div>
  );
};

// Scanning animation icon
const ScanIcon: React.FC = () => (
  <div className="relative">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="10" className="opacity-30" />
      <circle cx="12" cy="12" r="6" className="opacity-50" />
      <circle cx="12" cy="12" r="2" />
    </svg>
    <div className="absolute inset-0 animate-ping">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-30">
        <circle cx="12" cy="12" r="10" />
      </svg>
    </div>
  </div>
);

// Alert icon
const AlertIcon: React.FC = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

// Graduation icon
const GraduationIcon: React.FC = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </svg>
);

// Shield icon for high risk
const ShieldIcon: React.FC = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>
);

export const MetricsBar: React.FC<MetricsBarProps> = ({ stats, isLoading }) => {
  if (isLoading || !stats) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-zinc-800/50 backdrop-blur-xl border border-zinc-700/50 animate-pulse"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <MetricCard
        icon={<ScanIcon />}
        label="Scans Today"
        value={stats.scansToday}
        subValue={`${stats.scansTotal.toLocaleString()} total`}
        color="blue"
      />
      <MetricCard
        icon={<AlertIcon />}
        label="Alerts"
        value={stats.alertsToday}
        subValue={`${stats.highRiskAlerts} high risk`}
        color="amber"
      />
      <MetricCard
        icon={<GraduationIcon />}
        label="Graduations"
        value={stats.graduationsToday}
        subValue={`${stats.graduationsTotal.toLocaleString()} total`}
        color="emerald"
      />
      <MetricCard
        icon={<ShieldIcon />}
        label="High Risk"
        value={stats.highRiskAlerts}
        subValue="flagged today"
        color="red"
      />
    </div>
  );
};

export default MetricsBar;
