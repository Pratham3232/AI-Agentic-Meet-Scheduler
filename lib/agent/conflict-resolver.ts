import { SearchParams, TimeSlot } from '@/types';
import { addDays, subDays, format, parseISO, startOfDay, endOfDay } from 'date-fns';
import { findFreeSlots } from '../calendar/freebusy';
import { getTimeWindowBounds } from '../calendar/utils';
import { DebugLogger } from '../debug';

export async function resolveConflict(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string = 'UTC'
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const steps = [
    { fn: () => expandTimeWindow(params, debug, timezone),  label: 'expand_time_window' },
    { fn: () => tryAdjacentDays(params, debug, timezone),   label: 'adjacent_days'      },
    { fn: () => tryNextWeekdays(params, debug, timezone),   label: 'next_weekdays'      },
  ];

  for (let i = 0; i < steps.length; i++) {
    const result = await steps[i].fn();
    debug.log({ type: 'conflict_resolution', step: i + 1, strategy: steps[i].label, slotsFound: result.slots.length });
    if (result.slots.length > 0) return result;
  }

  debug.log({ type: 'conflict_resolution', step: 4, strategy: 'no_alternatives', slotsFound: 0 });
  return {
    slots: [],
    strategy: 'no_alternatives',
    message: `I couldn't find a ${params.duration}-minute slot around ${params.day}. Want to try a different week or adjust the duration?`,
  };
}

async function expandTimeWindow(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);
  const start = fromZonedDay(params.day, 8, timezone);
  const end   = fromZonedDay(params.day, 18, timezone);

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
  timezone: string
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);

  for (const targetDate of [addDays(date, 1), subDays(date, 1)]) {
    const day = format(targetDate, 'yyyy-MM-dd');
    const bounds = getTimeWindowBounds(day, params.timeWindow, timezone);
    const slots = await findFreeSlots(bounds.start, bounds.end, params.duration, undefined, debug);
    if (slots.length > 0) {
      return {
        slots,
        strategy: 'adjacent_day',
        message: `${format(date, 'EEEE')} is fully booked — how about ${format(targetDate, 'EEEE, MMMM d')} ${params.timeWindow}?`,
      };
    }
  }

  return { slots: [], strategy: 'adjacent_day', message: '' };
}

async function tryNextWeekdays(
  params: SearchParams,
  debug: DebugLogger,
  timezone: string
): Promise<{ slots: TimeSlot[]; strategy: string; message: string }> {
  const date = parseISO(params.day);
  const candidates: Date[] = [];

  for (let i = 1; candidates.length < 3 && i <= 14; i++) {
    const candidate = addDays(date, i);
    const dow = candidate.getDay();
    if (dow !== 0 && dow !== 6) candidates.push(candidate);
  }

  for (const targetDate of candidates) {
    const day = format(targetDate, 'yyyy-MM-dd');
    const start = fromZonedDay(day, 8, timezone);
    const end   = fromZonedDay(day, 18, timezone);
    const slots = await findFreeSlots(start, end, params.duration, undefined, debug);
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
