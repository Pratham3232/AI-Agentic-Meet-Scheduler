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

/** Last occurrence of a weekday (getDay: 0=Sun … 5=Fri) in a calendar month. */
export function resolveLastWeekdayOfMonth(
  year: number,
  month: number,
  weekdayIndex: number,
  timezone: string
): string {
  const lastDayNum = getDaysInMonth(monthAnchor(year, month, 1, timezone));
  for (let d = lastDayNum; d >= 1; d--) {
    const anchor = monthAnchor(year, month, d, timezone);
    if (getDay(anchor) === weekdayIndex) {
      return isoDayInTz(anchor, timezone);
    }
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(lastDayNum)}`;
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

const WEEKDAY_NAME_TO_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function tryParseLastWeekdayOfMonth(
  lower: string,
  timezone: string,
  today: Date
): string[] | null {
  const dayMatch = lower.match(
    /\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (!dayMatch) return null;

  const weekdayIndex = WEEKDAY_NAME_TO_INDEX[dayMatch[1]];
  if (weekdayIndex === undefined) return null;

  const monthOffset =
    /\bnext month\b/.test(lower) ? 1 :
    /\bthis month\b/.test(lower) ? 0 :
    null;

  let year: number;
  let month: number;

  const namedMonth = parseNamedMonth(lower, today, timezone);
  if (namedMonth) {
    year = namedMonth.year;
    month = namedMonth.month;
  } else if (monthOffset !== null) {
    const current = parseYearMonth(formatInTimeZone(today, timezone, 'yyyy-MM'));
    const target = shiftYearMonth(current.year, current.month, monthOffset);
    year = target.year;
    month = target.month;
  } else {
    return null;
  }

  const iso = resolveLastWeekdayOfMonth(year, month, weekdayIndex, timezone);
  return filterFutureDays([iso], timezone, today);
}

function tryParseNamedMonthDayRange(
  lower: string,
  timezone: string,
  today: Date
): string[] | null {
  const monthNames = [...new Set(Object.keys(MONTH_NAMES))].sort(
    (a, b) => b.length - a.length
  );
  for (const name of monthNames) {
    const pat = new RegExp(
      `\\b${name}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:to|through|-)\\s*(?:${name}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\b`
    );
    const match = lower.match(pat);
    if (!match) continue;

    const monthNum = MONTH_NAMES[name];
    const year = today.getFullYear();
    const pad = (n: number) => String(n).padStart(2, '0');
    const startDay = parseInt(match[1], 10);
    const endDay = parseInt(match[2], 10);
    if (startDay > endDay || endDay - startDay > 30) continue;

    const days: string[] = [];
    for (let d = startDay; d <= endDay; d++) {
      days.push(`${year}-${pad(monthNum)}-${pad(d)}`);
    }

    const wantsWeekdays =
      /\bweekdays?\b/.test(lower) ||
      /\bmonday\s*(?:through|to|-)\s*friday\b/.test(lower) ||
      /\bmon\s*[-–]\s*fri\b/i.test(lower);

    const filtered = wantsWeekdays
      ? days.filter(day => {
          const anchor = fromZonedTime(`${day}T12:00:00`, timezone);
          return MON_FRI.includes(getDay(anchor));
        })
      : days;

    return filterFutureDays(filtered, timezone, today);
  }
  return null;
}

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

function parseExplicitDate(lower: string, today: Date): string | null {
  const MONTH_LIST = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (let m = 0; m < MONTH_LIST.length; m++) {
    const name = MONTH_LIST[m];
    if (!lower.includes(name)) continue;
    const pat = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?${name}|${name}\\s*(\\d{1,2})`);
    const match = lower.match(pat);
    if (match) {
      const dayNum = parseInt(match[1] ?? match[2]);
      const year = today.getFullYear();
      const pad = (n: number) => String(n).padStart(2, '0');
      const candidate = new Date(year, m, dayNum);
      if (candidate < today) candidate.setFullYear(year + 1);
      return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}`;
    }
  }
  const isoMatch = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  return null;
}

/** Narrow check for chat auto-search skip only (Mon–Fri range phrases). */
export function isMultiDayRangeMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    /\bmonday\s*(?:through|to|-)\s*friday\b/i.test(lower) ||
    /\bnext\s+monday\b[\s\S]*\bfriday\b/i.test(lower)
  );
}

/** Upcoming Mon–Fri week starting at next Monday in the user's timezone. */
function resolveNextMondayToFridayWeek(
  timezone: string,
  today: Date,
  forceNextMonday: boolean
): string[] {
  const todayIso = formatInTimeZone(today, timezone, 'yyyy-MM-dd');
  const anchor = fromZonedTime(`${todayIso}T12:00:00`, timezone);
  const dow = parseInt(formatInTimeZone(anchor, timezone, 'i'), 10); // 1=Mon … 7=Sun
  let daysUntilMonday: number;
  if (dow === 1) {
    daysUntilMonday = forceNextMonday ? 7 : 0;
  } else if (dow === 7) {
    daysUntilMonday = 1;
  } else {
    daysUntilMonday = 8 - dow;
  }
  const monday = addDays(anchor, daysUntilMonday);
  const days = Array.from({ length: 5 }, (_, i) =>
    isoDayInTz(addDays(monday, i), timezone)
  );
  return filterFutureDays(days, timezone, today);
}

function tryParseMondayToFridayRange(
  lower: string,
  timezone: string,
  today: Date
): string[] | null {
  const hasNextMonday =
    /\bnext\s+monday\b/i.test(lower) && /\b(?:next\s+)?friday\b/i.test(lower);
  const hasMonToFri = /\bmonday\s*(?:through|to|-)\s*friday\b/i.test(lower);
  if (!hasNextMonday && !hasMonToFri) return null;
  if (
    /\b(?:next|this)\s+month\b/.test(lower) ||
    /\bfirst week\b/.test(lower) ||
    /\blast week\b/.test(lower)
  ) {
    return null;
  }
  return resolveNextMondayToFridayWeek(timezone, today, hasNextMonday);
}

export function parseBookingDayRequest(
  message: string,
  timezone: string,
  today: Date = new Date()
): string[] | null {
  const lower = message.toLowerCase();

  const monFriWeek = tryParseMondayToFridayRange(lower, timezone, today);
  if (monFriWeek && monFriWeek.length > 0) return monFriWeek;

  const lastWeekday = tryParseLastWeekdayOfMonth(lower, timezone, today);
  if (lastWeekday && lastWeekday.length > 0) return lastWeekday;

  const monthRange = tryParseNamedMonthDayRange(lower, timezone, today);
  if (monthRange && monthRange.length > 0) return monthRange;

  const startingFromMatch = lower.match(/\b(?:starting|start|from|beginning)\s+(?:from\s+)?(?:on\s+)?/);
  if (startingFromMatch) {
    const explicitDate = parseExplicitDate(lower, today);
    if (explicitDate) {
      const countMatch = lower.match(/\b(\d+)\s+(?:days?|meetings?|sessions?)\b/);
      const wantsWeekdays = /\bweekdays?\b|\bmon(?:day)?\s*(?:through|to|-)\s*fri(?:day)?\b|\bmon\s*[-–]\s*fri\b/i.test(lower);
      const count = countMatch ? Math.min(parseInt(countMatch[1], 10), 31) : (wantsWeekdays ? 5 : 5);
      const indices = wantsWeekdays ? [1, 2, 3, 4, 5] : undefined;
      const days: string[] = [];
      let cur = fromZonedTime(`${explicitDate}T12:00:00`, timezone);
      while (days.length < count) {
        const iso = isoDayInTz(cur, timezone);
        if (iso >= explicitDate) {
          if (indices) {
            if (indices.includes(getDay(cur))) days.push(iso);
          } else {
            days.push(iso);
          }
        }
        cur = addDays(cur, 1);
        if (days.length === 0 && iso > explicitDate) break;
      }
      if (days.length > 0) return days;
    }
  }

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
    const d = fromZonedTime(`${day}T12:00:00`, timezone);
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
