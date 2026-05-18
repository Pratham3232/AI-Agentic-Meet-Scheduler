'use client';

export type VoiceState = 'idle' | 'recording' | 'transcribing' | 'speaking';

interface VoiceButtonProps {
  state: VoiceState;
  onClick: () => void;
}

const CONFIG: Record<VoiceState, { icon: string; label: string; disabled: boolean }> = {
  idle:         { icon: '🎤', label: 'Start voice input',    disabled: false },
  recording:    { icon: '⏹',  label: 'Stop recording',       disabled: false },
  transcribing: { icon: '⏳', label: 'Transcribing…',        disabled: true  },
  speaking:     { icon: '🔇', label: 'Stop speaking',        disabled: false },
};

export default function VoiceButton({ state, onClick }: VoiceButtonProps) {
  const { icon, label, disabled } = CONFIG[state];
  return (
    <button
      className={`voice-button voice-state-${state} ${state !== 'idle' ? 'active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {icon}
    </button>
  );
}
