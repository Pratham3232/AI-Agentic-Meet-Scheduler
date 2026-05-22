import { BookingJob, ConversationState, Message, SearchParams } from '@/types';

export function updateSlot(
  state: ConversationState,
  slotName: keyof ConversationState['slots'],
  value: any
): ConversationState {
  return {
    ...state,
    slots: {
      ...state.slots,
      [slotName]: value,
    },
  };
}

export function addMessage(
  state: ConversationState,
  role: 'user' | 'assistant',
  content: string
): ConversationState {
  const message: Message = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    conversationHistory: [...state.conversationHistory, message],
    turnCount: state.turnCount + 1,
  };
}

export function setCalendarResults(
  state: ConversationState,
  results: any[]
): ConversationState {
  return {
    ...state,
    calendarResults: results,
  };
}

export function setAwaitingConfirmation(
  state: ConversationState,
  awaiting: boolean
): ConversationState {
  return {
    ...state,
    awaitingConfirmation: awaiting,
  };
}

export function setLastSearchParams(
  state: ConversationState,
  params: SearchParams | null
): ConversationState {
  return {
    ...state,
    lastSearchParams: params,
  };
}

export function hasAllRequiredSlots(state: ConversationState): boolean {
  return (
    state.slots.duration !== null &&
    state.slots.day !== null &&
    state.slots.timeWindow !== null
  );
}

export function getNextMissingSlot(state: ConversationState): string | null {
  if (state.slots.duration === null) return 'duration';
  if (state.slots.day === null) return 'day';
  if (state.slots.timeWindow === null) return 'timeWindow';
  return null;
}

export function resetSlots(state: ConversationState): ConversationState {
  return {
    ...state,
    slots: {
      duration: null,
      day: null,
      timeWindow: null,
      preferredStart: null,
      preferredEnd: null,
      attendees: [],
    },
    calendarResults: [],
    awaitingConfirmation: false,
    lastSearchParams: null,
    bookingJob: null,
    cancelJob: null,
    lastBulkCancelTarget: null,
    cancelPlanConfirmed: false,
    confirmedCancelSummary: null,
    lastMultiDayPlan: null,
    bookingPlanConfirmed: false,
    confirmedPlanSummary: null,
    cachedCalendar: null,
    calendarVersion: 0,
    pendingReschedule: null,
    lastRescheduledEvent: null,
  };
}

export function setBookingJob(
  state: ConversationState,
  job: BookingJob | null
): ConversationState {
  return { ...state, bookingJob: job };
}

export function getActiveBookingJob(state: ConversationState): BookingJob | null {
  return state.bookingJob;
}
