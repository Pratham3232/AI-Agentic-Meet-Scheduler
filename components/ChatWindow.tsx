'use client';

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

type SlotOption = { display: string; start: string; end: string };
type EventItem = { id: string; summary: string; display: string };

interface ChatWindowProps {
  messages: Array<{ role: string; content: string; slots?: SlotOption[]; events?: EventItem[] }>;
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
        <MessageBubble
          key={index}
          role={message.role}
          content={message.content}
          slots={message.slots}
          events={message.events}
          onSlotPick={onSlotPick}
        />
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
