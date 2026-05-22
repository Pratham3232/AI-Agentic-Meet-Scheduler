import type { PlanMultiDayResult } from '@/lib/agent/multi-booking';
import { getBookingProgress } from '@/lib/agent/booking-executor';
import type { ConversationState, LastMultiDayPlan } from '@/types';

export type MultiDayInitEntry = {
  day: string;
  start: string;
  end: string;
  summary: string;
};

const LARGE_PLAN_THRESHOLD = 7;

export function buildInitEntriesFromPlan(
  plan: PlanMultiDayResult,
  defaultSummary = 'Meeting'
): MultiDayInitEntry[] {
  return plan.autoBookable
    .filter(e => e.start && e.end)
    .map(e => ({
      day: e.day,
      start: e.start!,
      end: e.end!,
      summary: defaultSummary,
    }));
}

export function buildLastMultiDayPlan(
  plan: PlanMultiDayResult,
  preferredTime: string,
  summary = 'Meeting'
): LastMultiDayPlan {
  return {
    days: plan.days,
    initEntries: buildInitEntriesFromPlan(plan, summary),
    preferredTime,
    totalDays: plan.totalDays,
    summary,
    conflictCount: plan.conflicts.length,
  };
}

export function buildShortPlanSummary(plan: LastMultiDayPlan): string {
  const { totalDays, preferredTime, days, initEntries, summary } = plan;
  const count = initEntries.length || totalDays;
  const title = summary && summary !== 'Meeting' ? `${summary} — ` : '';
  if (days.length === 0) {
    return `${title}${count} meeting(s) at ${preferredTime}`;
  }
  const sorted = [...days].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const monthLabel = first.slice(0, 7);
  const range =
    first === last
      ? first
      : `${first} through ${last}`;
  return `${title}${count} meeting(s) — ${range} (${monthLabel}) at ${preferredTime}`;
}

/** Clear an abandoned in-progress job when user starts a new plan. */
export function stateUpdatesForNewPlan(
  state: ConversationState
): Partial<ConversationState> {
  const resets: Partial<ConversationState> = {
    bookingPlanConfirmed: false,
    confirmedPlanSummary: null,
  };
  if (!state.bookingJob) return resets;

  const progress = getBookingProgress(state.bookingJob);
  if (state.bookingJob.sseInProgress || progress.pending > 0) {
    return { ...resets, bookingJob: null };
  }
  return resets;
}

/** Prefer canonical server entries when the model passes a short list. */
export function resolveInitEntries(
  llmEntries: MultiDayInitEntry[],
  lastPlan: LastMultiDayPlan | null | undefined
): { entries: MultiDayInitEntry[]; overridden: boolean } {
  if (!lastPlan) {
    return { entries: llmEntries, overridden: false };
  }
  const canonical = lastPlan.initEntries;
  if (canonical.length === 0) {
    return { entries: llmEntries, overridden: false };
  }
  if (llmEntries.length > canonical.length) {
    return { entries: llmEntries, overridden: false };
  }
  if (llmEntries.length < canonical.length) {
    return { entries: canonical, overridden: true };
  }
  return { entries: llmEntries, overridden: false };
}

export function buildPlanToolResult(plan: PlanMultiDayResult): Record<string, unknown> {
  const large = plan.totalDays > LARGE_PLAN_THRESHOLD;
  const conflictNote =
    plan.conflicts.length > 0 && plan.autoBookable.length === 0
      ? ' All days have conflicts — resolve each with the user, then init_booking_job with entries using their chosen alternatives (start/end per conflict day).'
      : plan.conflicts.length > 0
        ? ` ${plan.conflicts.length} conflict day(s) need user picks before init.`
        : '';

  const base: Record<string, unknown> = {
    autoBookable: plan.autoBookable,
    conflicts: plan.conflicts,
    summary: plan.summary,
    totalDays: plan.totalDays,
    days: plan.days,
    weekdayLabels: plan.weekdayLabels,
    initEntriesCount: plan.autoBookable.filter(e => e.start && e.end).length,
    conflictCount: plan.conflicts.length,
    hint:
      plan.conflicts.length === 0
        ? large
          ? `All ${plan.totalDays} day(s) available. Confirm with a ONE-line summary (count + month + time) — do NOT list every day or paste displayList. Then init_booking_job; server has initEntriesCount canonical entries.${conflictNote}`
          : `All ${plan.days.length} day(s) available. Ask ONE confirmation, then init_booking_job with every autoBookable entry. Do NOT re-plan after confirm.${conflictNote}`
        : large
          ? `Show ONLY conflict days (one alternative each). Do not enumerate all ${plan.totalDays} days in chat. After user picks, init_booking_job with one entry per resolved day.${conflictNote}`
          : `Show ONLY conflict days (one alternative each). After user picks, init_booking_job once.${conflictNote}`,
  };
  if (!large) {
    base.displayList = plan.displayList;
  }
  return base;
}
