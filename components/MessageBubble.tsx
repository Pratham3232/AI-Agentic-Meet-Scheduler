'use client';

interface MessageBubbleProps {
  role: string;
  content: string;
}

export default function MessageBubble({ role, content }: MessageBubbleProps) {
  return (
    <div className={`message ${role}`}>
      {content}
    </div>
  );
}
