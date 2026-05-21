import { addDays, getDay } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export interface BookingDayPattern {
  monthOffset?: number;
  weekdaysOnly?: boolean;
  weekdayIndices?: number[];
}

function isoDayInTz(date: Date, timezone: string): string {
  return formatInTimeZone(date, timezone, 'yyyy-MM-dd');
}

function parseYearMonth(ym: string): { year: number; month: number } {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, month: m };
}

function shiftYearMonth(year: number, month: number, offset: number): { year: number; month: number } {
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

function monthAnchor(year: number, month: number, day: number, timezone: string): Date {
  const pad = (n: number) => String(n).padStart(2, '0');
  return fromZonedTime(`${year}-${pad(month)}-${pad(day)}T12:00:00`, timezone);
}

/** Calendar days 1–7 of the target month in the user's timezone. */
export function resolveFirstWeekOfMonth(
  monthOffset: number,
  timezone: string,
  today: Date = new Date()
): { startDay: string; endDay: string; days: string[] } {
  const current = parseYearMonth(formatInTimeZone(today, timezone, 'yyyy-MM'));
  const target = shiftYearMonth(current.year, current.month, monthOffset);

  const days: string[] = [];
  for (let d = 1; d <= 7; d++) {
    days.push(isoDayInTz(monthAnchor(target.year, target.month, d, timezone), timezone));
  }

  return {
    startDay: days[0],
    endDay: days[days.length - 1],
    days,
  };
}

export function resolveWeekdaysInRange(
  startDay: string,
  endDay: string,
  weekdayIndices: number[],
  timezone: string
): string[] {
  const out: string[] = [];
  let cur = startDay;
  while (cur <= endDay) {
    const anchor = fromZonedTime(`${cur}T12:00:00`, timezone);
    if (weekdayIndices.includes(getDay(anchor))) {
      out.push(cur);
    }
    cur = isoDayInTz(addDays(anchor, 1), timezone);
  }
  return out;
}

/** Mon=1 … Fri=5 in getDay: Monday=1, Friday=5 */
const MON_FRI = [1, 2, 3, 4, 5];

export function parseBookingDayRequest(
  message: string,
  timezone: string,
  today: Date = new Date()
): string[] | null {
  const lower = message.toLowerCase();

  const monthOffset =
    /\bnext month\b/.test(lower) ? 1 :
    /\bthis month\b/.test(lower) ? 0 :
    null;

  const wantsFirstWeek = /\bfirst week\b/.test(lower);
  const wantsWeekdays =
    /\bmonday\s*(?:through|to|-)\s*friday\b/.test(lower) ||
    /\bmon\s*[-–]\s*fri\b/i.test(lower) ||
    /\bevery weekday\b/.test(lower) ||
    /\bweekdays?\b/.test(lower);

  if (wantsFirstWeek && monthOffset !== null && wantsWeekdays) {
    const week = resolveFirstWeekOfMonth(monthOffset, timezone, today);
    return resolveWeekdaysInRange(week.startDay, week.endDay, MON_FRI, timezone);
  }

  if (wantsFirstWeek && monthOffset !== null) {
    return resolveFirstWeekOfMonth(monthOffset, timezone, today).days;
  }

  if (wantsWeekdays && monthOffset !== null) {
    const week = resolveFirstWeekOfMonth(monthOffset, timezone, today);
    return resolveWeekdaysInRange(week.startDay, week.endDay, MON_FRI, timezone);
  }

  return null;
}

export function formatDayListForDisplay(days: string[], timezone: string): string[] {
  return days.map(day => {
    const d = new Date(`${day}T12:00:00Z`);
    const label = formatInTimeZone(d, timezone, 'EEEE, MMMM d');
    return `${label} (${day})`;
  });
}

export function entriesFingerprint(
  entries: Array<{ day: string; start: string }>
): string {
  return entries
    .map(e => `${e.day}|${e.start}`)
    .sort()
    .join(';');
}
