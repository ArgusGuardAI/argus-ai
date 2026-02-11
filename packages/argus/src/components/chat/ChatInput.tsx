/**
 * ChatInput - Text input with send button
 *
 * Features:
 * - Auto-grow textarea
 * - Enter to send (Shift+Enter for newline)
 * - Disabled state while sending
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  disabled = false,
  placeholder = 'Ask Argus anything...',
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [value]);

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setValue('');
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="flex items-end gap-2 p-3 bg-[#0a0a0a] border-t border-[#222]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className="flex-1 bg-[#111] border border-[#252525] rounded-xl px-4 py-2.5 text-sm text-[#e5e5e5] placeholder-[#555] resize-none focus:outline-none focus:border-[#333] disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ minHeight: '42px', maxHeight: '120px' }}
      />
      <button
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="flex-shrink-0 w-10 h-10 bg-red-600 hover:bg-red-700 disabled:bg-[#222] disabled:cursor-not-allowed rounded-xl flex items-center justify-center transition-colors"
        title="Send message"
      >
        <svg
          className="w-5 h-5 text-white"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
          />
        </svg>
      </button>
    </div>
  );
};

export default ChatInput;
