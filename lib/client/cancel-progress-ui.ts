import type { CancelProgressSnapshot } from '@/types';
import type { ProgressMessage } from '@/lib/client/booking-progress-ui';

export function cancelProgressContent(snap: CancelProgressSnapshot): string {
  return snap.status === 'completed' || snap.pending === 0
    ? `Cancellation complete — ${snap.cancelled} cancelled, ${snap.failed} failed.`
    : 'Cancelling meetings…';
}

export function isNewCancelJob(
  current: CancelProgressSnapshot | null,
  next: CancelProgressSnapshot
): boolean {
  if (!current) return true;
  if (current.jobId === next.jobId) return false;
  return current.status === 'completed' || current.pending === 0;
}

export function shouldApplyCancelProgress(
  current: CancelProgressSnapshot | null,
  next: CancelProgressSnapshot
): boolean {
  if (!current) return true;
  if (current.jobId !== next.jobId) return isNewCancelJob(current, next);
  if (current.total > 0 && current.cancelled === current.total && next.pending > 0) {
    return false;
  }
  if (current.status === 'completed' && next.status === 'in_progress') return false;
  return true;
}

export function findCancelProgressMessageIndex(messages: ProgressMessage[]): number {
  return messages.findIndex(m => m.role === 'assistant' && m.cancelProgress);
}

export function upsertCancelProgressMessage(
  prev: ProgressMessage[],
  snap: CancelProgressSnapshot,
  options?: { content?: string; attachToLastAssistant?: boolean }
): ProgressMessage[] {
  const content = options?.content ?? cancelProgressContent(snap);
  const progressIdx = findCancelProgressMessageIndex(prev);
  const stripped = prev.map(m =>
    m.cancelProgress ? { ...m, cancelProgress: undefined } : m
  );

  if (options?.attachToLastAssistant) {
    for (let i = stripped.length - 1; i >= 0; i--) {
      if (stripped[i].role === 'assistant') {
        const updated = [...stripped];
        updated[i] = { ...stripped[i], cancelProgress: snap };
        return updated;
      }
    }
  }

  const progressMsg: ProgressMessage = {
    role: 'assistant',
    content,
    cancelProgress: snap,
  };

  if (progressIdx >= 0) {
    const updated = [...stripped];
    const existing = stripped[progressIdx];
    const preserved =
      Boolean(existing.content?.trim()) &&
      !existing.content.startsWith('Cancellation complete') &&
      !existing.content.startsWith('Cancelling meetings');
    updated[progressIdx] = {
      ...existing,
      content: preserved ? existing.content : content,
      cancelProgress: snap,
    };
    return updated;
  }
  return [...stripped, progressMsg];
}
