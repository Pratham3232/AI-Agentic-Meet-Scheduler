export interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  confidence?: number;
}

export interface ConversationState {
  sessionId: string;
  slots: {
    duration: number | null;       // minutes
    day: string | null;            // ISO date string
    timeWindow: string | null;     // "morning" | "afternoon" | "evening" | ISO range
    attendees: string[];
  };
  calendarResults: TimeSlot[];
  awaitingConfirmation: boolean;
  lastSearchParams: SearchParams | null;
  turnCount: number;
  conversationHistory: Message[];
}

export interface SearchParams {
  duration: number;
  day: string;
  timeWindow: string;
  attendees?: string[];
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  message?: string;
  toolCalls?: ToolCall[];
  reasoning?: string;
}

export interface TimeExpression {
  raw: string;
  start: string;
  end: string;
  confidence: number;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{ email: string }>;
}
