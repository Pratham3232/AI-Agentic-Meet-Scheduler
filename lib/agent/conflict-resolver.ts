import { SearchParams, TimeSlot, WorkingHours } from '@/types';
import { addDays, subDays, format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { findFreeSlots } from '../calendar/slot-search';
import { getTimeWindowBounds } from '../calendar/utils';
import { DebugLogger } from '../debug';

export async function resolveConflict(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string = 'UTC',
  workingHours?: WorkingHours
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const t0 = Date.now();
  const [expandResult, adjacentResult, weekdayResult] = await Promise.all([
    expandTimeWindow(params, debug, timezone, workingHours),
    tryAdjacentDays(params, debug, timezone, workingHours),
    tryNextWeekdays(params, debug, timezone, workingHours),
  ]);

  console.log(`[PERF][conflict] parallel strategies: ${Date.now() - t0}ms`);

  // Return results in priority order (expand > adjacent > next weekdays)
  if (expandResult.slots.length > 0) {
    debug.log({ type: 'conflict_resolution', step: 1, strategy: 'expand_time_window', slotsFound: expandResult.slots.length });
    console.log(`[PERF][conflict] resolveConflict total: ${Date.now() - t0}ms (expand_window)`);
    return expandResult;
  }
  if (adjacentResult.slots.length > 0) {
    debug.log({ type: 'conflict_resolution', step: 2, strategy: 'adjacent_days', slotsFound: adjacentResult.slots.length });
    console.log(`[PERF][conflict] resolveConflict total: ${Date.now() - t0}ms (adjacent_days)`);
    return adjacentResult;
  }
  if (weekdayResult.slots.length > 0) {
    debug.log({ type: 'conflict_resolution', step: 3, strategy: 'next_weekdays', slotsFound: weekdayResult.slots.length });
    console.log(`[PERF][conflict] resolveConflict total: ${Date.now() - t0}ms (next_weekdays)`);
    return weekdayResult;
  }

  debug.log({ type: 'conflict_resolution', step: 4, strategy: 'no_alternatives', slotsFound: 0 });
  console.log(`[PERF][conflict] resolveConflict total: ${Date.now() - t0}ms`);
  return {
    slots: [],
    strategy: 'no_alternatives',
    message: `I couldn't find a ${params.duration}-minute slot around ${params.day}. Want to try a different week or adjust the duration?`,
  };
}

async function expandTimeWindow(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string,
  workingHours?: WorkingHours
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);
  const startH = workingHours?.startHour ?? 9;
  const endH   = workingHours?.endHour ?? 17;
  const start = fromZonedDay(params.day, startH, timezone);
  const end   = fromZonedDay(params.day, endH, timezone);

  const slots = await findFreeSlots(start, end, params.duration, undefined, debug);
  const label = format(date, 'EEEE, MMMM d');
  return {
    slots,
    strategy: 'expanded_time_window',
    message: slots.length > 0
      ? `Nothing in the ${params.timeWindow}, but here are other times on ${label}:`
      : '',
  };
}

async function tryAdjacentDays(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string,
  workingHours?: WorkingHours
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);
  const nextDay = addDays(date, 1);
  const prevDay = subDays(date, 1);

  const [nextSlots, prevSlots] = await Promise.all(
    [nextDay, prevDay].map(targetDate => {
      const day = format(targetDate, 'yyyy-MM-dd');
      const bounds = getTimeWindowBounds(day, params.timeWindow, timezone, undefined, workingHours);
      return findFreeSlots(bounds.start, bounds.end, params.duration, undefined, debug);
    })
  );

  if (nextSlots.length > 0) {
    return {
      slots: nextSlots,
      strategy: 'adjacent_day',
      message: `${format(date, 'EEEE')} is fully booked — how about ${format(nextDay, 'EEEE, MMMM d')} ${params.timeWindow}?`,
    };
  }
  if (prevSlots.length > 0) {
    return {
      slots: prevSlots,
      strategy: 'adjacent_day',
      message: `${format(date, 'EEEE')} is fully booked — how about ${format(prevDay, 'EEEE, MMMM d')} ${params.timeWindow}?`,
    };
  }

  return { slots: [], strategy: 'adjacent_day', message: '' };
}

async function tryNextWeekdays(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string,
  workingHours?: WorkingHours
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);
  const candidates: Date[] = [];

  for (let i = 1; candidates.length < 3 && i <= 14; i++) {
    const candidate = addDays(date, i);
    const dow = candidate.getDay();
    if (dow !== 0 && dow !== 6) candidates.push(candidate);
  }

  const startH = workingHours?.startHour ?? 9;
  const endH   = workingHours?.endHour ?? 17;
  const results = await Promise.all(
    candidates.map(targetDate => {
      const day = format(targetDate, 'yyyy-MM-dd');
      const start = fromZonedDay(day, startH, timezone);
      const end   = fromZonedDay(day, endH, timezone);
      return findFreeSlots(start, end, params.duration, undefined, debug)
        .then(slots => ({ slots, date: targetDate }));
    })
  );

  for (const { slots, date: targetDate } of results) {
    if (slots.length > 0) {
      return {
        slots,
        strategy: 'next_weekdays',
        message: `No luck on ${format(date, 'EEEE')}. Here are options on ${format(targetDate, 'EEEE, MMMM d')}:`,
      };
    }
  }

  return { slots: [], strategy: 'next_weekdays', message: '' };
}

/** Build a UTC ISO string for hour H on a given day in the user's timezone. */
function fromZonedDay(day: string, hour: number, timezone: string): string {
  const { fromZonedTime } = require('date-fns-tz');
  return fromZonedTime(
    `${day}T${String(hour).padStart(2, '0')}:00:00`,
    timezone
  ).toISOString();
}
