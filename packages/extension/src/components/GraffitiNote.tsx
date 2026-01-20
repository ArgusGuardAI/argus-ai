import type { GraffitiNote as GraffitiNoteType } from '@argusguard/shared';

interface GraffitiNoteProps {
  note: GraffitiNoteType;
  onVote?: (noteId: string, vote: 'up' | 'down') => void;
}

const noteTypeConfig: Record<GraffitiNoteType['noteType'], {
  className: string;
  icon: string;
  iconBg: string;
  accentColor: string;
  tagText: string;
}> = {
  WARNING: {
    className: 'graffiti-warning',
    icon: '!',
    iconBg: 'bg-gradient-to-br from-red-500 to-pink-600',
    accentColor: '#ff3366',
    tagText: 'DANGER',
  },
  INFO: {
    className: 'graffiti-info',
    icon: 'i',
    iconBg: 'bg-gradient-to-br from-cyan-400 to-blue-500',
    accentColor: '#00d4ff',
    tagText: 'INFO',
  },
  POSITIVE: {
    className: 'graffiti-positive',
    icon: '+',
    iconBg: 'bg-gradient-to-br from-emerald-400 to-green-500',
    accentColor: '#00ff88',
    tagText: 'LEGIT',
  },
};

export function GraffitiNote({ note, onVote }: GraffitiNoteProps) {
  const config = noteTypeConfig[note.noteType];
  const shortenedWallet = `${note.authorWallet.slice(0, 4)}...${note.authorWallet.slice(-4)}`;
  const timeAgo = getTimeAgo(note.createdAt);

  return (
    <div className={`graffiti-note ${config.className} rounded-xl p-4 relative overflow-hidden`}>
      {/* Spray paint texture overlay */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative flex items-start gap-4">
        {/* Icon badge */}
        <div
          className={`${config.iconBg} w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg`}
          style={{
            boxShadow: `0 0 15px ${config.accentColor}40`,
          }}
        >
          <span className="font-graffiti text-white text-xl font-bold">{config.icon}</span>
        </div>

        <div className="flex-1 min-w-0">
          {/* Tag */}
          <div className="flex items-center gap-2 mb-2">
            <span
              className="font-graffiti text-[10px] px-2 py-0.5 rounded"
              style={{
                background: `${config.accentColor}20`,
                color: config.accentColor,
                border: `1px solid ${config.accentColor}40`,
              }}
            >
              {config.tagText}
            </span>
            {note.verified && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 font-cyber">
                HOLDER
              </span>
            )}
          </div>

          {/* Content - graffiti style */}
          <p
            className="font-graffiti text-sm text-gray-100 break-words leading-relaxed mt-1"
            style={{
              textShadow: '1px 1px 2px rgba(0,0,0,0.5)',
            }}
          >
            {note.content}
          </p>

          {/* Meta info */}
          <div className="flex items-center gap-2 mt-3 text-[10px]" style={{ color: '#6b7280' }}>
            <span className="font-mono opacity-70">{shortenedWallet}</span>
            <span style={{ color: config.accentColor }}>|</span>
            <span className="opacity-70">{timeAgo}</span>
          </div>
        </div>
      </div>

      {/* Vote buttons */}
      {onVote && (
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-white/10">
          <button
            onClick={() => onVote(note.id, 'up')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-emerald-400 transition-all group"
          >
            <span
              className="w-6 h-6 rounded flex items-center justify-center bg-white/5 group-hover:bg-emerald-500/20 transition-colors"
              style={{ fontSize: '10px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 4l-8 8h5v8h6v-8h5z"/>
              </svg>
            </span>
            <span className="font-cyber text-[10px]">{note.upvotes}</span>
          </button>

          <button
            onClick={() => onVote(note.id, 'down')}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-400 transition-all group"
          >
            <span
              className="w-6 h-6 rounded flex items-center justify-center bg-white/5 group-hover:bg-red-500/20 transition-colors"
              style={{ fontSize: '10px' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 20l8-8h-5v-8h-6v8h-5z"/>
              </svg>
            </span>
            <span className="font-cyber text-[10px]">{note.downvotes}</span>
          </button>

          <div className="flex-1" />

          <span className="text-[9px] text-gray-600 font-cyber">
            {note.upvotes - note.downvotes > 0 ? '+' : ''}{note.upvotes - note.downvotes} TRUST
          </span>
        </div>
      )}

      {/* Decorative drip effect */}
      <div
        className="absolute bottom-0 left-4 w-1 h-3 rounded-full opacity-20"
        style={{ background: config.accentColor }}
      />
    </div>
  );
}

function getTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return new Date(timestamp).toLocaleDateString();
}
