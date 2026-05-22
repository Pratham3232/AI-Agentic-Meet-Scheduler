'use client';

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import BookingProgress from './BookingProgress';
import CancelProgress from './CancelProgress';
import MultiDayPlanCards, { type PlanDayEntry } from './MultiDayPlanCards';
import type { BookingProgressSnapshot, CancelProgressSnapshot } from '@/types';

type SlotOption = { display: string; start: string; end: string };
type EventItem = { id: string; summary: string; display: string };

interface ChatWindowProps {
  messages: Array<{
    role: string;
    content: string;
    slots?: SlotOption[];
    events?: EventItem[];
    bookingProgress?: BookingProgressSnapshot;
    cancelProgress?: CancelProgressSnapshot;
    multiDayPlan?: { autoBookable?: PlanDayEntry[]; conflicts?: PlanDayEntry[] };
  }>;
  isLoading: boolean;
  onSlotPick?: (slot: SlotOption) => void;
}

export default function ChatWindow({ messages, isLoading, onSlotPick }: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-messages">
      {messages.map((message, index) => (
        <div key={index}>
          <MessageBubble
            role={message.role}
            content={message.content}
            slots={message.slots}
            events={message.events}
            onSlotPick={onSlotPick}
          />
          {message.bookingProgress && (
            <BookingProgress progress={message.bookingProgress} />
          )}
          {message.cancelProgress && (
            <CancelProgress progress={message.cancelProgress} />
          )}
          {message.multiDayPlan && (
            <MultiDayPlanCards
              autoBookable={message.multiDayPlan.autoBookable}
              conflicts={message.multiDayPlan.conflicts}
            />
          )}
        </div>
      ))}

      {isLoading && (
        <div className="message assistant">
          <div className="loading">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
