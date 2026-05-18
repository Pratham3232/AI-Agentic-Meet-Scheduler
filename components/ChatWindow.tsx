'use client';

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

interface ChatWindowProps {
  messages: Array<{ role: string; content: string }>;
  isLoading: boolean;
}

export default function ChatWindow({ messages, isLoading }: ChatWindowProps) {
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
