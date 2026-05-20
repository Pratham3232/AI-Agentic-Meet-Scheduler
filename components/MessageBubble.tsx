'use client';

type SlotOption = { display: string; start: string; end: string };
type EventItem = { id: string; summary: string; display: string };

interface MessageBubbleProps {
  role: string;
  content: string;
  slots?: SlotOption[];
  events?: EventItem[];
  onSlotPick?: (slot: SlotOption) => void;
}

export default function MessageBubble({ role, content, slots, events, onSlotPick }: MessageBubbleProps) {
  const hasSlots = slots && slots.length > 0;
  const hasEvents = events && events.length > 0;
  const hasCards = hasSlots || hasEvents;

  const displayContent = hasCards
    ? content.replace(/^\d+\.\s.+$/gm, '').replace(/[📅📋]\s*/g, '').trim()
      || (hasSlots ? 'Available slots:' : 'Your schedule:')
    : content;

  return (
    <div className={`message ${role}${hasCards ? ' has-slots' : ''}`}>
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

      {hasEvents && (
        <div className="slot-list">
          {events.map((evt, i) => (
            <div key={i} className="slot-card event-card">
              <span className="slot-number event-number">{i + 1}</span>
              <div className="event-info">
                <span className="event-name">{evt.summary}</span>
                <span className="event-time">{evt.display}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
