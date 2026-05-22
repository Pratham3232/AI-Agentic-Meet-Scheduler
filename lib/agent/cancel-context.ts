import type { CancelJob, CancelProgressSnapshot, ConversationState } from '@/types';
import { getCancelProgress } from '@/lib/agent/cancel-executor';

export function isCancelJobFinished(job: CancelJob | null): boolean {
  if (!job) return false;
  const progress = getCancelProgress(job);
  return job.status === 'completed' || (progress.cancelled > 0 && progress.pending === 0);
}

export function buildCancelJobPromptBlock(state: ConversationState): string {
  const job = state.cancelJob;
  if (!job || !isCancelJobFinished(job)) return '';

  const progress = getCancelProgress(job);
  const lines = job.items
    .filter(i => i.status === 'cancelled')
    .slice(0, 8)
    .map(i => `- ${i.summary} ${i.display ?? ''}`)
    .join('\n');
  const more =
    progress.cancelled > 8 ? `\n(and ${progress.cancelled - 8} more)` : '';

  const summary = state.confirmedCancelSummary?.trim() || `${progress.cancelled} event(s) removed`;

  return `
## Cancel job COMPLETE (authoritative)
${summary}
Status: ${progress.cancelled} cancelled, ${progress.failed} failed, ${progress.pending} pending.
${lines ? `Cancelled:\n${lines}${more}\n` : ''}
FORBIDDEN: init_cancel_job, execute_cancel_batch, delete_event for these events again.
If the user asks whether cancellations finished, confirm YES.`;
}

export function buildCancelJobPromptBlockFromSnapshot(
  snap: CancelProgressSnapshot,
  confirmedSummary?: string | null
): string {
  if (snap.pending > 0 && snap.status !== 'completed') return '';

  const summary =
    confirmedSummary?.trim() || `${snap.cancelled} event(s) cancelled`;

  return `
## Cancel job COMPLETE (authoritative)
${summary}
Status: ${snap.cancelled} cancelled, ${snap.failed} failed, ${snap.pending} pending.
FORBIDDEN: init_cancel_job, execute_cancel_batch, delete_event for these events again.`;
}

export function cancelCompleteConversationHint(snap: CancelProgressSnapshot): string {
  return (
    `[CANCEL_COMPLETE] ${snap.cancelled} event(s) cancelled (${snap.failed} failed). ` +
    `Do NOT call delete_event or init_cancel_job again.`
  );
}
