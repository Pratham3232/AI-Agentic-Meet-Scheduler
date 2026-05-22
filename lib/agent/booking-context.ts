import type { BookingJob, BookingJobItem, BookingProgressSnapshot, ConversationState } from '@/types';
import { getBookingProgress } from '@/lib/agent/booking-progress';

function sameSlot(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart === bStart && aEnd === bEnd;
}

export function isBookingJobFinished(job: BookingJob | null): boolean {
  if (!job) return false;
  const progress = getBookingProgress(job);
  return (
    job.status === 'completed' ||
    (progress.booked > 0 && progress.pending === 0)
  );
}

export function findBookedJobItemForSlot(
  state: ConversationState,
  startTime: string,
  endTime: string,
  summary?: string
): BookingJobItem | null {
  const job = state.bookingJob;
  if (!job) return null;

  const normalizedSummary = summary?.trim().toLowerCase();
  for (const item of job.items) {
    if (item.status !== 'booked') continue;
    if (!sameSlot(item.start, item.end, startTime, endTime)) continue;
    if (
      normalizedSummary &&
      item.summary.toLowerCase() !== normalizedSummary
    ) {
      continue;
    }
    return item;
  }
  return null;
}

export function buildBookingJobPromptBlock(state: ConversationState): string {
  const job = state.bookingJob;
  if (!job || !isBookingJobFinished(job)) return '';

  const progress = getBookingProgress(job);
  const bookedLines = job.items
    .filter(i => i.status === 'booked')
    .map(i => `- ${i.summary} ${i.display ?? `${i.start} – ${i.end}`}`)
    .join('\n');

  const summary =
    state.confirmedPlanSummary?.trim() ||
    `${progress.booked} meeting(s) on calendar`;

  return `
## Booking job COMPLETE (authoritative — trust this over conflicts)
${summary}
Status: ${progress.booked} booked, ${progress.failed} failed, ${progress.pending} pending.
${bookedLines ? `Booked:\n${bookedLines}\n` : ''}
FORBIDDEN after this block: init_booking_job, execute_booking_batch, create_event, find_free_slots, find_next_slot for the same plan or times above.
If the user asks whether meetings are booked, confirm YES using the list above — do NOT say booking failed or offer to book one-by-one.
If create_event would conflict, those events are almost certainly THIS job — do not rebook.`;
}

export function buildBookingJobPromptBlockFromSnapshot(
  snap: BookingProgressSnapshot,
  confirmedSummary?: string | null
): string {
  if (snap.pending > 0 && snap.status !== 'completed') return '';

  const bookedLines = snap.items
    .filter(i => i.status === 'booked')
    .map(i => `- ${i.summary} ${i.display ?? `${i.start} – ${i.end}`}`)
    .join('\n');

  const summary =
    confirmedSummary?.trim() ||
    `${snap.booked} meeting(s) on calendar`;

  return `
## Booking job COMPLETE (authoritative — trust this over conflicts)
${summary}
Status: ${snap.booked} booked, ${snap.failed} failed, ${snap.pending} pending.
${bookedLines ? `Booked:\n${bookedLines}\n` : ''}
FORBIDDEN after this block: init_booking_job, execute_booking_batch, create_event, find_free_slots, find_next_slot for the same plan or times above.
If the user asks whether meetings are booked, confirm YES using the list above — do NOT say booking failed or offer to book one-by-one.`;
}

/** Injected into Realtime conversation when SSE finishes so the model sees completion. */
export function bookingCompleteConversationHint(
  snap: BookingProgressSnapshot
): string {
  const lines = snap.items
    .filter(i => i.status === 'booked')
    .map(i => i.display ?? i.summary)
    .join('; ');
  return (
    `[BOOKING_COMPLETE] All ${snap.booked} meeting(s) are on the calendar (${snap.failed} failed). ` +
    `Do NOT call create_event, init_booking_job, execute_booking_batch, or find_free_slots to re-book. ` + 
    (lines ? `Booked: ${lines}.` : '')
  );
}

export type CreateEventReconcileResult = {
  success: true;
  alreadyBooked: true;
  eventId?: string;
  summary: string;
  start: string;
  end: string;
  displayTime?: string;
  message: string;
};

export function tryReconcileCreateEventWithBookingJob(
  state: ConversationState,
  startTime: string,
  endTime: string,
  summary: string
): CreateEventReconcileResult | null {
  const item = findBookedJobItemForSlot(state, startTime, endTime, summary);
  if (!item) {
    if (!isBookingJobFinished(state.bookingJob)) return null;
    const loose = findBookedJobItemForSlot(state, startTime, endTime);
    if (!loose) return null;
    return {
      success: true,
      alreadyBooked: true,
      eventId: loose.eventId,
      summary: loose.summary,
      start: loose.start,
      end: loose.end,
      displayTime: loose.display,
      message: `Already booked as "${loose.summary}" (${loose.display ?? 'on calendar'}). Do not create again.`,
    };
  }
  return {
    success: true,
    alreadyBooked: true,
    eventId: item.eventId,
    summary: item.summary,
    start: item.start,
    end: item.end,
    displayTime: item.display,
    message: `Already booked as "${item.summary}" (${item.display ?? 'on calendar'}). Do not create again.`,
  };
}
