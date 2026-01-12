import { useState } from 'react';
import type { GraffitiNote } from '@whaleshield/shared';
import { WHALESHIELD_TOKEN } from '@whaleshield/shared';
import { getAuthMessage, createGraffitiNote, createTestGraffitiNote } from '~/lib/api';

type NoteType = 'WARNING' | 'INFO' | 'POSITIVE';

interface CreateNoteFormProps {
  tokenAddress: string;
  walletAddress: string | null;
  connected: boolean;
  isPremium: boolean;
  onConnect: () => Promise<void>;
  signMessage: (message: string) => Promise<string | null>;
  onNoteCreated: (note: GraffitiNote) => void;
}

const isTestMode = WHALESHIELD_TOKEN.mint === 'TBD_AFTER_LAUNCH';

const noteTypeOptions: {
  type: NoteType;
  label: string;
  icon: string;
  color: string;
  bgActive: string;
}[] = [
  {
    type: 'WARNING',
    label: 'DANGER',
    icon: '!',
    color: '#ff3366',
    bgActive: 'rgba(255, 51, 102, 0.15)',
  },
  {
    type: 'INFO',
    label: 'INFO',
    icon: 'i',
    color: '#00d4ff',
    bgActive: 'rgba(0, 212, 255, 0.15)',
  },
  {
    type: 'POSITIVE',
    label: 'LEGIT',
    icon: '+',
    color: '#00ff88',
    bgActive: 'rgba(0, 255, 136, 0.15)',
  },
];

export function CreateNoteForm({
  tokenAddress,
  walletAddress,
  connected,
  isPremium,
  onConnect,
  signMessage,
  onNoteCreated,
}: CreateNoteFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('INFO');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    if (!isTestMode && !walletAddress) return;

    setIsSubmitting(true);
    setError(null);

    try {
      let result;

      if (isTestMode) {
        result = await createTestGraffitiNote({
          tokenAddress,
          content: content.trim(),
          noteType,
        });
      } else {
        const authMsg = await getAuthMessage('graffiti', tokenAddress);
        if (!authMsg) {
          setError('Auth failed');
          return;
        }

        const signature = await signMessage(authMsg.message);
        if (!signature) {
          setError('Signature failed');
          return;
        }

        result = await createGraffitiNote({
          tokenAddress,
          content: content.trim(),
          noteType,
          walletAddress: walletAddress!,
          message: authMsg.message,
          signature,
        });
      }

      if (!result.success) {
        setError(result.error || 'Failed');
        return;
      }

      if (result.note) {
        onNoteCreated(result.note);
      }
      setContent('');
      setIsOpen(false);
    } catch (err) {
      setError('Error occurred');
      console.error('Create note error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Not connected
  if (!isTestMode && !connected) {
    return (
      <button
        onClick={onConnect}
        className="btn-cyber w-full py-3 px-4 rounded-lg text-xs flex items-center justify-center gap-2"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
        </svg>
        CONNECT WALLET TO TAG
      </button>
    );
  }

  // Not premium
  if (!isTestMode && !isPremium) {
    return (
      <div className="py-3 px-4 rounded-lg text-center" style={{ background: 'rgba(123, 44, 191, 0.1)', border: '1px solid rgba(123, 44, 191, 0.3)' }}>
        <p className="text-[11px] text-gray-400">
          <span className="text-purple-400 mr-1">🔒</span>
          Hold <span className="text-cyan-400 font-bold">1,000 $WHALESHIELD</span> to spray
        </p>
      </div>
    );
  }

  // Collapsed
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full py-3 px-4 rounded-xl text-xs font-cyber tracking-wider flex items-center justify-center gap-3 transition-all hover:scale-[1.02]"
        style={{
          background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.1) 0%, rgba(0, 136, 204, 0.05) 100%)',
          border: '1px solid rgba(0, 212, 255, 0.3)',
          color: '#00d4ff',
          boxShadow: '0 0 20px rgba(0, 212, 255, 0.1)',
        }}
      >
        <span className="text-lg">🎨</span>
        ADD GRAFFITI
      </button>
    );
  }

  const selectedOption = noteTypeOptions.find((o) => o.type === noteType)!;

  // Expanded form
  return (
    <div
      className="rounded-xl p-4 relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, rgba(10, 10, 18, 0.95) 0%, rgba(3, 3, 8, 0.98) 100%)',
        border: '1px solid rgba(0, 212, 255, 0.25)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="font-graffiti text-lg">🎨</span>
          <span className="text-[10px] font-cyber text-cyan-400 tracking-widest">SPRAY YOUR TAG</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="w-5 h-5 flex items-center justify-center rounded bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-colors text-sm"
        >
          ×
        </button>
      </div>

      {/* Note Type Selector */}
      <div className="flex gap-2 mb-4">
        {noteTypeOptions.map((option) => {
          const isActive = noteType === option.type;
          return (
            <button
              key={option.type}
              onClick={() => setNoteType(option.type)}
              className="flex-1 py-2.5 px-2 rounded-lg text-[10px] font-graffiti transition-all flex items-center justify-center gap-1.5"
              style={{
                background: isActive ? option.bgActive : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${isActive ? option.color + '50' : 'rgba(255, 255, 255, 0.05)'}`,
                color: isActive ? option.color : '#6b7280',
                boxShadow: isActive ? `0 0 15px ${option.color}20` : 'none',
              }}
            >
              <span
                className="w-4 h-4 rounded text-[9px] flex items-center justify-center font-bold"
                style={{
                  background: isActive ? option.color : 'transparent',
                  color: isActive ? '#000' : option.color,
                }}
              >
                {option.icon}
              </span>
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      {/* Content Input */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value.slice(0, 500))}
        placeholder="Leave your mark..."
        className="input-cyber w-full rounded-lg p-3 text-sm font-graffiti resize-none h-20"
        style={{ background: 'rgba(0, 0, 0, 0.4)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
        maxLength={500}
      />

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 mb-4">
        <span className="text-[9px] text-gray-600 font-mono">{content.length}/500</span>
        {error && (
          <span className="text-[9px] text-red-400 font-cyber">{error}</span>
        )}
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !content.trim()}
        className="w-full py-3 rounded-xl text-xs font-cyber font-bold tracking-wider transition-all relative overflow-hidden"
        style={{
          background: isSubmitting || !content.trim()
            ? 'rgba(255, 255, 255, 0.05)'
            : `linear-gradient(135deg, ${selectedOption.color} 0%, ${selectedOption.color}cc 100%)`,
          color: isSubmitting || !content.trim() ? '#4a5568' : '#000',
          cursor: isSubmitting || !content.trim() ? 'not-allowed' : 'pointer',
          boxShadow: isSubmitting || !content.trim() ? 'none' : `0 0 20px ${selectedOption.color}40`,
        }}
      >
        {isSubmitting ? (
          <span className="flex items-center justify-center gap-2">
            <span className="animate-spin">◐</span>
            SPRAYING...
          </span>
        ) : (
          'SPRAY IT'
        )}
      </button>

      {/* Wallet info */}
      <p className="text-[9px] text-gray-600 mt-2 text-center">
        {isTestMode ? (
          <span className="text-cyan-500/70">TEST MODE ACTIVE</span>
        ) : (
          <span className="font-mono opacity-70">
            {walletAddress?.slice(0, 4)}...{walletAddress?.slice(-4)}
          </span>
        )}
      </p>
    </div>
  );
}
