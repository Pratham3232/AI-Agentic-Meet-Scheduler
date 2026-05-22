import { addDays, getDay, getDaysInMonth, startOfWeek, endOfWeek } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export interface BookingDayPattern {
  monthOffset?: number;
  weekdaysOnly?: boolean;
  weekdayIndices?: number[];
  /** first/last week of month; omit for full-month weekdays when monthOffset set */
  week?: 'first' | 'last';
  month?: number;
  year?: number;
  scope?: 'fullMonth' | 'firstWeek' | 'lastWeek';
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

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

/** Mon–Sun week that contains the last calendar day of the month. */
export function resolveLastWeekOfMonth(
  year: number,
  month: number,
  timezone: string
): { startDay: string; endDay: string; days: string[] } {
  const lastDayNum = getDaysInMonth(monthAnchor(year, month, 1, timezone));
  const monthEnd = monthAnchor(year, month, lastDayNum, timezone);
  const weekStart = startOfWeek(monthEnd, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days: string[] = [];
  let cur = weekStart;
  while (cur <= weekEnd) {
    days.push(isoDayInTz(cur, timezone));
    cur = addDays(cur, 1);
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

/** All Mon–Fri dates within a calendar month (user timezone). */
export function resolveAllWeekdaysInMonth(
  year: number,
  month: number,
  timezone: string,
  weekdayIndices: number[] = MON_FRI
): string[] {
  const lastDay = getDaysInMonth(monthAnchor(year, month, 1, timezone));
  const startDay = isoDayInTz(monthAnchor(year, month, 1, timezone), timezone);
  const endDay = isoDayInTz(monthAnchor(year, month, lastDay, timezone), timezone);
  return resolveWeekdaysInRange(startDay, endDay, weekdayIndices, timezone);
}

/** Every calendar day in a month (user timezone). */
export function resolveAllDaysInMonth(
  year: number,
  month: number,
  timezone: string
): string[] {
  const lastDay = getDaysInMonth(monthAnchor(year, month, 1, timezone));
  const days: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    days.push(isoDayInTz(monthAnchor(year, month, d, timezone), timezone));
  }
  return days;
}

/** Drop dates strictly before today in the user's timezone. */
export function filterFutureDays(
  days: string[],
  timezone: string,
  today: Date = new Date()
): string[] {
  const todayIso = formatInTimeZone(today, timezone, 'yyyy-MM-dd');
  return days.filter(d => d >= todayIso);
}

function targetMonthFromOffset(
  monthOffset: number,
  today: Date,
  timezone: string
): { year: number; month: number } {
  const current = parseYearMonth(formatInTimeZone(today, timezone, 'yyyy-MM'));
  return shiftYearMonth(current.year, current.month, monthOffset);
}

function parseNamedMonth(lower: string, today: Date, timezone: string): { year: number; month: number } | null {
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      const nowYm = parseYearMonth(formatInTimeZone(today, timezone, 'yyyy-MM'));
      let year = nowYm.year;
      if (num < nowYm.month && !/\bnext year\b/.test(lower)) {
        year += 1;
      }
      if (/\bnext year\b/.test(lower)) year = nowYm.year + 1;
      return { year, month: num };
    }
  }
  return null;
}

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
  const wantsLastWeek = /\blast week\b/.test(lower);
  const wantsAllCalendarDays =
    /\bevery day\b/.test(lower) ||
    /\beach day\b/.test(lower) ||
    /\ball days\b/.test(lower);
  const wantsDaily = /\bdaily\b/.test(lower);
  const wantsWeekdays =
    wantsDaily ||
    /\bmonday\s*(?:through|to|-)\s*friday\b/.test(lower) ||
    /\bmon\s*[-–]\s*fri\b/i.test(lower) ||
    /\bevery weekday\b/.test(lower) ||
    /\bweekdays?\b/.test(lower);

  const namedMonth = parseNamedMonth(lower, today, timezone);

  if (wantsLastWeek && namedMonth) {
    const week = resolveLastWeekOfMonth(namedMonth.year, namedMonth.month, timezone);
    if (wantsWeekdays) {
      const weekdays = resolveWeekdaysInRange(week.startDay, week.endDay, MON_FRI, timezone);
      const monthPrefix = `${namedMonth.year}-${String(namedMonth.month).padStart(2, '0')}`;
      return weekdays.filter(d => d.startsWith(monthPrefix));
    }
    return week.days.filter(d => d.startsWith(`${namedMonth.year}-${String(namedMonth.month).padStart(2, '0')}`));
  }

  if (wantsLastWeek && monthOffset !== null) {
    const current = parseYearMonth(formatInTimeZone(today, timezone, 'yyyy-MM'));
    const target = shiftYearMonth(current.year, current.month, monthOffset);
    const week = resolveLastWeekOfMonth(target.year, target.month, timezone);
    if (wantsWeekdays) {
      const weekdays = resolveWeekdaysInRange(week.startDay, week.endDay, MON_FRI, timezone);
      const monthPrefix = `${target.year}-${String(target.month).padStart(2, '0')}`;
      return weekdays.filter(d => d.startsWith(monthPrefix));
    }
    return week.days;
  }

  if (wantsFirstWeek && monthOffset !== null && wantsWeekdays) {
    const week = resolveFirstWeekOfMonth(monthOffset, timezone, today);
    return resolveWeekdaysInRange(week.startDay, week.endDay, MON_FRI, timezone);
  }

  if (wantsFirstWeek && monthOffset !== null) {
    return resolveFirstWeekOfMonth(monthOffset, timezone, today).days;
  }

  if (
    (wantsAllCalendarDays || wantsWeekdays) &&
    monthOffset !== null &&
    !wantsFirstWeek &&
    !wantsLastWeek
  ) {
    const target = targetMonthFromOffset(monthOffset, today, timezone);
    const days = wantsAllCalendarDays && !wantsWeekdays
      ? resolveAllDaysInMonth(target.year, target.month, timezone)
      : resolveAllWeekdaysInMonth(target.year, target.month, timezone, MON_FRI);
    return filterFutureDays(days, timezone, today);
  }

  if (
    (wantsAllCalendarDays || wantsWeekdays) &&
    namedMonth &&
    !wantsFirstWeek &&
    !wantsLastWeek
  ) {
    const days = wantsAllCalendarDays && !wantsWeekdays
      ? resolveAllDaysInMonth(namedMonth.year, namedMonth.month, timezone)
      : resolveAllWeekdaysInMonth(namedMonth.year, namedMonth.month, timezone, MON_FRI);
    return filterFutureDays(days, timezone, today);
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
