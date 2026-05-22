import type { BookingProgressSnapshot } from '@/types';

import type { CancelProgressSnapshot } from '@/types';

export type ProgressMessage = {
  role: string;
  content: string;
  bookingProgress?: BookingProgressSnapshot;
  cancelProgress?: CancelProgressSnapshot;
  slots?: unknown[];
  events?: unknown[];
};

export function bookingProgressContent(snap: BookingProgressSnapshot): string {
  return snap.status === 'completed' || snap.pending === 0
    ? `Booking complete — ${snap.booked} booked, ${snap.failed} failed.`
    : 'Booking in progress…';
}

/** True when starting a fresh job after the previous one finished. */
export function isNewBookingJob(
  current: BookingProgressSnapshot | null,
  next: BookingProgressSnapshot
): boolean {
  if (!current) return true;
  if (current.jobId === next.jobId) return false;
  return current.status === 'completed' || current.pending === 0;
}

export function shouldApplyBookingProgress(
  current: BookingProgressSnapshot | null,
  next: BookingProgressSnapshot
): boolean {
  if (!current) return true;
  if (current.jobId !== next.jobId) {
    return isNewBookingJob(current, next);
  }
  if (current.total > 0 && current.booked === current.total && next.pending > 0) {
    return false;
  }
  if (current.status === 'completed' && next.status === 'in_progress') {
    return false;
  }
  return true;
}

export function findProgressMessageIndex(messages: ProgressMessage[]): number {
  return messages.findIndex(m => m.role === 'assistant' && m.bookingProgress);
}

/** Keep a single in-chat progress card; optionally attach to the last assistant reply. */
export function upsertBookingProgressMessage(
  prev: ProgressMessage[],
  snap: BookingProgressSnapshot,
  options?: { content?: string; attachToLastAssistant?: boolean }
): ProgressMessage[] {
  const defaultContent = bookingProgressContent(snap);
  const content = options?.content ?? defaultContent;

  const progressIdx = findProgressMessageIndex(prev);
  const stripped = prev.map(m =>
    m.bookingProgress ? { ...m, bookingProgress: undefined } : m
  );

  if (options?.attachToLastAssistant) {
    for (let i = stripped.length - 1; i >= 0; i--) {
      if (stripped[i].role === 'assistant') {
        const updated = [...stripped];
        updated[i] = { ...stripped[i], bookingProgress: snap };
        return updated;
      }
    }
  }

  const progressMsg: ProgressMessage = {
    role: 'assistant',
    content,
    bookingProgress: snap,
  };

  if (progressIdx >= 0) {
    const updated = [...stripped];
    updated[progressIdx] = progressMsg;
    return updated;
  }
  return [...stripped, progressMsg];
}

export function messagesHaveCompletedProgress(
  messages: ProgressMessage[],
  jobId: string
): boolean {
  const m = messages.find(
    x => x.bookingProgress?.jobId === jobId && x.bookingProgress.pending === 0
  );
  return Boolean(m);
}
