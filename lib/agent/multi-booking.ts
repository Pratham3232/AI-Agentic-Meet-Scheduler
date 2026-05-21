import {
  buildLocalSlotRange,
  eventsOverlappingRange,
  findAllFreeSlotsInWindow,
  isSlotFree,
  rankSlotsByProximity,
  filterFutureSlots,
} from '@/lib/calendar/slot-search';
import { formatTimeSlot } from '@/lib/calendar/utils';
import { listEvents } from '@/lib/calendar/events';
import { DebugLogger } from '@/lib/debug';
import { TimeSlot, WorkingHours } from '@/types';
import { parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

export interface PlanMultiDayArgs {
  durationMinutes: number;
  days: string[];
  preferredTime: string;
  timezone: string;
  workingHours?: WorkingHours;
}

export interface DayPlanEntry {
  day: string;
  status: 'auto_bookable' | 'conflict';
  start?: string;
  end?: string;
  display?: string;
  requestedDisplay?: string;
  blockers?: Array<{ summary: string; display: string }>;
  suggestedAlternative?: { start: string; end: string; display: string };
}

export interface PlanMultiDayResult {
  autoBookable: DayPlanEntry[];
  conflicts: DayPlanEntry[];
  summary: string;
  totalDays: number;
}

function parsePreferredHourMinute(preferredTime: string): { hour: number; minute: number } {
  const trimmed = preferredTime.trim();
  const ampm = trimmed.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const mer = ampm[3].toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    return { hour, minute };
  }
  const hhmm = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    return { hour: parseInt(hhmm[1], 10), minute: parseInt(hhmm[2], 10) };
  }
  const hourOnly = trimmed.match(/^(\d{1,2})$/);
  if (hourOnly) {
    return { hour: parseInt(hourOnly[1], 10), minute: 0 };
  }
  return { hour: 9, minute: 0 };
}

export async function planMultiDayBookings(
  args: PlanMultiDayArgs,
  debug: DebugLogger,
  now: Date = new Date()
): Promise<PlanMultiDayResult> {
  const { durationMinutes, days, preferredTime, timezone, workingHours } = args;
  const { hour, minute } = parsePreferredHourMinute(preferredTime);
  const startH = workingHours?.startHour ?? 9;
  const endH = workingHours?.endHour ?? 17;

  const autoBookable: DayPlanEntry[] = [];
  const conflicts: DayPlanEntry[] = [];

  for (const day of days.slice(0, 14)) {
    const { start, end } = buildLocalSlotRange(day, hour, minute, durationMinutes, timezone);
    const requestedDisplay = formatTimeSlot({ start, end }, timezone);
    const available = await isSlotFree(start, end);

    if (available && parseISO(start) >= now) {
      autoBookable.push({
        day,
        status: 'auto_bookable',
        start,
        end,
        display: requestedDisplay,
      });
      continue;
    }

    const dayStart = `${day}T${String(startH).padStart(2, '0')}:00:00`;
    const dayEnd = `${day}T${String(endH).padStart(2, '0')}:00:00`;
    const boundsStart = fromZonedTime(dayStart, timezone).toISOString();
    const boundsEnd = fromZonedTime(dayEnd, timezone).toISOString();

    const allSlots = filterFutureSlots(
      await findAllFreeSlotsInWindow(boundsStart, boundsEnd, durationMinutes),
      now
    );
    const anchor = parseISO(start);
    const ranked = rankSlotsByProximity(anchor, allSlots);
    const alternative = ranked[0];

    const existingEvents = await listEvents(start, end, undefined, debug);
    const overlapping = eventsOverlappingRange(existingEvents, start, end);
    const blockers = overlapping
      .filter(e => e.start?.dateTime && e.end?.dateTime)
      .map(e => ({
        summary: e.summary ?? '(no title)',
        display: formatTimeSlot(
          { start: e.start!.dateTime!, end: e.end!.dateTime! },
          timezone
        ),
      }));

    const entry: DayPlanEntry = {
      day,
      status: 'conflict',
      requestedDisplay,
      blockers,
      suggestedAlternative: alternative
        ? {
            start: alternative.start,
            end: alternative.end,
            display: formatTimeSlot(alternative, timezone),
          }
        : undefined,
    };
    conflicts.push(entry);
  }

  debug.log({
    type: 'tool_result',
    tool: 'plan_multi_day_bookings',
    summary: `${autoBookable.length} auto, ${conflicts.length} conflicts`,
  });

  const summary =
    conflicts.length === 0
      ? `All ${autoBookable.length} day(s) are available at ${preferredTime}. Confirm once to book all.`
      : `${autoBookable.length} of ${days.length} day(s) ready to book; ${conflicts.length} need your pick.`;

  return {
    autoBookable,
    conflicts,
    summary,
    totalDays: days.length,
  };
}
