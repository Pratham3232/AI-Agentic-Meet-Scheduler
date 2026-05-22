export interface TimeSlot {
  start: string; // ISO datetime
  end: string;   // ISO datetime
  confidence?: number;
}

export interface WorkingHours {
  startHour: number; // 0-23
  endHour: number;   // 0-23
}

export type BookingItemStatus = 'pending' | 'booked' | 'failed' | 'skipped';

export interface BookingJobItem {
  day: string;
  start: string;
  end: string;
  summary: string;
  status: BookingItemStatus;
  eventId?: string;
  error?: string;
  display?: string;
}

export type BookingJobStatus = 'idle' | 'in_progress' | 'completed' | 'failed';

export interface BookingJob {
  id: string;
  status: BookingJobStatus;
  items: BookingJobItem[];
  updatedAt: string;
  sseInProgress?: boolean;
  entriesFingerprint?: string;
}

export interface BookingProgressSnapshot {
  jobId: string;
  status: BookingJobStatus;
  total: number;
  booked: number;
  failed: number;
  pending: number;
  skipped: number;
  percent: number;
  items: BookingJobItem[];
}

export type CancelItemStatus = 'pending' | 'cancelled' | 'failed' | 'skipped';

export interface CancelJobItem {
  eventId: string;
  summary: string;
  start: string;
  end: string;
  status: CancelItemStatus;
  error?: string;
  display?: string;
}

export type CancelJobStatus = 'idle' | 'in_progress' | 'completed' | 'failed';

export interface CancelJob {
  id: string;
  status: CancelJobStatus;
  items: CancelJobItem[];
  updatedAt: string;
  sseInProgress?: boolean;
  eventIdsFingerprint?: string;
}

export interface CancelProgressSnapshot {
  jobId: string;
  status: CancelJobStatus;
  total: number;
  cancelled: number;
  failed: number;
  pending: number;
  skipped: number;
  percent: number;
  items: CancelJobItem[];
}

export interface LastBulkCancelTarget {
  timeMin: string;
  timeMax: string;
  eventIds: string[];
  count: number;
  summary: string;
}

export interface CachedCalendarSnapshot {
  timeMin: string;
  timeMax: string;
  fetchedAt: string;
  events: Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
    display: string;
  }>;
}

export interface PendingReschedule {
  eventId: string;
  summary: string;
  oldStart: string;
  oldEnd: string;
  oldDisplay: string;
  day: string;
  newStartTime?: string;
  newEndTime?: string;
  newDisplay?: string;
}

export interface LastRescheduledEvent {
  eventId: string;
  summary: string;
  start: string;
  end: string;
  display: string;
  day: string;
}

export interface LastMultiDayPlan {
  days: string[];
  initEntries: Array<{
    day: string;
    start: string;
    end: string;
    summary: string;
  }>;
  fingerprint: string;
  preferredTime: string;
  totalDays: number;
  summary: string;
  conflictCount: number;
}

export interface ConversationState {
  sessionId: string;
  bookingJob: BookingJob | null;
  cancelJob: CancelJob | null;
  lastBulkCancelTarget: LastBulkCancelTarget | null;
  cancelPlanConfirmed: boolean;
  confirmedCancelSummary: string | null;
  lastMultiDayPlan: LastMultiDayPlan | null;
  bookingPlanConfirmed: boolean;
  confirmedPlanSummary: string | null;
  cachedCalendar: CachedCalendarSnapshot | null;
  calendarVersion: number;
  pendingReschedule: PendingReschedule | null;
  lastRescheduledEvent: LastRescheduledEvent | null;
  slots: {
    duration: number | null;       // minutes
    day: string | null;            // ISO date string
    timeWindow: string | null;     // "morning" | "afternoon" | "evening" | ISO range
    preferredStart: string | null; // e.g. "10:00" or ISO
    preferredEnd: string | null;
    attendees: string[];
  };
  calendarResults: TimeSlot[];
  awaitingConfirmation: boolean;
  lastSearchParams: SearchParams | null;
  turnCount: number;
  conversationHistory: Message[];
  workingHours?: WorkingHours;
}

export interface SearchParams {
  duration: number;
  day: string;
  timeWindow: string;
  preferredStartTime?: string;
  preferredEndTime?: string;
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
