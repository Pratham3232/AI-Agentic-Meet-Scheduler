'use client';

type SlotOption = { display: string; start: string; end: string };

interface MessageBubbleProps {
  role: string;
  content: string;
  slots?: SlotOption[];
  onSlotPick?: (slot: SlotOption) => void;
}

export default function MessageBubble({ role, content, slots, onSlotPick }: MessageBubbleProps) {
  const hasSlots = slots && slots.length > 0;

  const displayContent = hasSlots
    ? content.replace(/^\d+\.\s.+$/gm, '').replace(/📅\s*/g, '').trim() || 'Available slots:'
    : content;

  return (
    <div className={`message ${role}${hasSlots ? ' has-slots' : ''}`}>
      <div className="message-text">{displayContent}</div>
      {hasSlots && (
        <div className="slot-list">
          {slots.map((slot, i) => (
            <button
              key={i}
              className="slot-card"
              onClick={() => onSlotPick?.(slot)}
            >
              <span className="slot-number">{i + 1}</span>
              <span className="slot-time">{slot.display}</span>
              <span className="slot-book-hint">Book</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
