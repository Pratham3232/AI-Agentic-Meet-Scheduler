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
import {
  parseBookingDayRequest,
  resolveFirstWeekOfMonth,
  resolveLastWeekOfMonth,
  resolveAllWeekdaysInMonth,
  resolveWeekdaysInRange,
  filterFutureDays,
  formatDayListForDisplay,
  type BookingDayPattern,
} from '@/lib/agent/booking-days';
import { formatInTimeZone } from 'date-fns-tz';
import { DebugLogger } from '@/lib/debug';
import { WorkingHours } from '@/types';
import { parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

const MON_FRI = [1, 2, 3, 4, 5];

export interface PlanMultiDayArgs {
  durationMinutes: number;
  days?: string[];
  preferredTime: string;
  timezone: string;
  workingHours?: WorkingHours;
  dayPattern?: BookingDayPattern;
  userMessage?: string;
}

export function resolvePlanDays(
  days: string[] | undefined,
  timezone: string,
  options?: { dayPattern?: BookingDayPattern; userMessage?: string },
  now: Date = new Date()
): string[] {
  const safeDays = days ?? [];
  let userMessageParsed = false;
  if (options?.userMessage) {
    const parsed = parseBookingDayRequest(options.userMessage, timezone, now);
    if (parsed?.length) {
      userMessageParsed = true;
      return parsed;
    }
  }

  if (safeDays.length > 0 && !userMessageParsed) {
    return safeDays;
  }

  const pattern = options?.dayPattern;
  if (pattern?.week === 'last' && pattern.month) {
    const year =
      pattern.year ??
      parseInt(formatInTimeZone(now, timezone, 'yyyy'), 10);
    const week = resolveLastWeekOfMonth(year, pattern.month, timezone);
    const indices = pattern.weekdayIndices ?? (pattern.weekdaysOnly ? MON_FRI : undefined);
    if (indices?.length) {
      const weekdays = resolveWeekdaysInRange(week.startDay, week.endDay, indices, timezone);
      const monthPrefix = `${year}-${String(pattern.month).padStart(2, '0')}`;
      return weekdays.filter(d => d.startsWith(monthPrefix));
    }
    const monthPrefix = `${year}-${String(pattern.month).padStart(2, '0')}`;
    return week.days.filter(d => d.startsWith(monthPrefix));
  }

  if (pattern?.week === 'first' && pattern.monthOffset !== undefined) {
    const week = resolveFirstWeekOfMonth(pattern.monthOffset, timezone, now);
    if (pattern.weekdaysOnly || pattern.weekdayIndices?.length) {
      const indices = pattern.weekdayIndices ?? MON_FRI;
      return resolveWeekdaysInRange(week.startDay, week.endDay, indices, timezone);
    }
    return week.days;
  }

  if (pattern?.monthOffset !== undefined) {
    const current = parseYearMonthFromNow(now, timezone);
    const target = shiftYearMonthHelper(current.year, current.month, pattern.monthOffset);
    const indices = pattern.weekdayIndices ?? MON_FRI;

    if (
      pattern.scope === 'fullMonth' ||
      ((pattern.weekdaysOnly || pattern.weekdayIndices?.length) && !pattern.week)
    ) {
      return filterFutureDays(
        resolveAllWeekdaysInMonth(target.year, target.month, timezone, indices),
        timezone,
        now
      );
    }

    const week = resolveFirstWeekOfMonth(pattern.monthOffset, timezone, now);
    if (pattern.weekdaysOnly || pattern.weekdayIndices?.length) {
      return resolveWeekdaysInRange(week.startDay, week.endDay, indices, timezone);
    }
    return week.days;
  }

  return safeDays;
}

function parseYearMonthFromNow(now: Date, timezone: string): { year: number; month: number } {
  const ym = formatInTimeZone(now, timezone, 'yyyy-MM');
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

function shiftYearMonthHelper(year: number, month: number, offset: number): { year: number; month: number } {
  let m = month + offset;
  let y = year;
  while (m > 12) {
    m -= 12;
    y += 1;
  }
  while (m < 1) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
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
  days: string[];
  weekdayLabels: string[];
  displayList: string[];
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
  const { durationMinutes, preferredTime, timezone, workingHours } = args;
  const days = resolvePlanDays(args.days, timezone, {
    dayPattern: args.dayPattern,
    userMessage: args.userMessage,
  }, now);
  const { hour, minute } = parsePreferredHourMinute(preferredTime);
  const startH = workingHours?.startHour ?? 9;
  const endH = workingHours?.endHour ?? 17;

  const autoBookable: DayPlanEntry[] = [];
  const conflicts: DayPlanEntry[] = [];

  const planDays = days.slice(0, 31);
  for (const day of planDays) {
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

    const outsideWorkingHours = hour < startH || hour >= endH;
    const searchStartH = outsideWorkingHours ? 0 : startH;
    const searchEndH = outsideWorkingHours ? 24 : endH;
    const dayStart = `${day}T${String(searchStartH).padStart(2, '0')}:00:00`;
    const dayEnd = `${day}T${String(searchEndH).padStart(2, '0')}:00:00`;
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

  const batchNote =
    days.length > 5
      ? ` ${days.length} weekday(s) total — booking runs in batches via progress UI after init.`
      : '';
  const summary =
    conflicts.length === 0
      ? `All ${autoBookable.length} of ${days.length} day(s) are available at ${preferredTime}. Confirm once to book all.${batchNote}`
      : `${autoBookable.length} of ${days.length} day(s) ready to book; ${conflicts.length} need your pick.${batchNote}`;

  const weekdayLabels = formatDayListForDisplay(days, timezone);
  const displayList = days.map((day, i) => {
    const entry = autoBookable.find(e => e.day === day) ?? conflicts.find(e => e.day === day);
    const timeLabel = entry?.display ?? entry?.requestedDisplay ?? preferredTime;
    return `${weekdayLabels[i]} at ${timeLabel}`;
  });

  return {
    autoBookable,
    conflicts,
    summary,
    totalDays: days.length,
    days,
    weekdayLabels,
    displayList,
  };
}
