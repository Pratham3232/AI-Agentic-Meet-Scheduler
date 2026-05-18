import { ConversationState } from '@/types';
import { updateSlot } from './state';
import { format, addDays } from 'date-fns';
import { DebugLogger } from '../debug';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Urgency patterns that mean "today / as soon as possible"
const ASAP_RE = /\b(asap|as soon as possible|soonest|earliest|right\s*away|right\s*now|immediately|urgent(ly)?|now)\b/i;

// Word numbers → integer value
const WORD_NUMS: [RegExp, number][] = [
  [/\b(one|an?)\b/i,        1],
  [/\btwo\b/i,              2],
  [/\bthree\b/i,            3],
  [/\bfour\b/i,             4],
  [/\bfive\b/i,             5],
  [/\bsix\b/i,              6],
  [/\bseven\b/i,            7],
  [/\beight\b/i,            8],
  [/\bnine\b/i,             9],
  [/\bten\b/i,              10],
  [/\bfifteen\b/i,          15],
  [/\btwenty\b/i,           20],
  [/\bthirty\b/i,           30],
  [/\bforty[\s-]?five\b/i,  45],
  [/\bforty\b/i,            40],
  [/\bsixty\b/i,            60],
  [/\bninety\b/i,           90],
];

function wordToNum(token: string): number | null {
  for (const [re, val] of WORD_NUMS) {
    if (re.test(token)) return val;
  }
  return null;
}

export function extractAndUpdateSlots(
  message: string,
  state: ConversationState,
  debug: DebugLogger,
  today: Date = new Date()
): ConversationState {
  const changes: string[] = [];
  let updated = state;

  const newDuration = extractDuration(message);
  if (newDuration !== null && newDuration !== state.slots.duration) {
    updated = updateSlot(updated, 'duration', newDuration);
    changes.push(`duration: ${state.slots.duration ?? 'null'} → ${newDuration}min`);
  }

  const newDay = extractDay(message, today);
  if (newDay !== null && newDay !== state.slots.day) {
    updated = updateSlot(updated, 'day', newDay);
    changes.push(`day: ${state.slots.day ?? 'null'} → ${newDay}`);
  }

  const newTimeWindow = extractTimeWindow(message);
  if (newTimeWindow !== null && newTimeWindow !== state.slots.timeWindow) {
    updated = updateSlot(updated, 'timeWindow', newTimeWindow);
    changes.push(`timeWindow: ${state.slots.timeWindow ?? 'null'} → ${newTimeWindow}`);
  }

  const newAttendees = extractAttendees(message).filter(a => !state.slots.attendees.includes(a));
  if (newAttendees.length > 0) {
    updated = updateSlot(updated, 'attendees', [...updated.slots.attendees, ...newAttendees]);
    changes.push(`attendees: added ${newAttendees.join(', ')}`);
  }

  const keyChanged = changes.some(c =>
    c.startsWith('duration:') || c.startsWith('day:') || c.startsWith('timeWindow:')
  );
  if (keyChanged && (state.calendarResults.length > 0 || state.awaitingConfirmation)) {
    updated = { ...updated, calendarResults: [], awaitingConfirmation: false, lastSearchParams: null };
    changes.push('→ cleared stale calendar results');
  }

  debug.log({ type: 'slot_extraction', message, changes, state: { ...updated.slots } });
  return updated;
}

// ── Duration ──────────────────────────────────────────────────────────────────
function extractDuration(message: string): number | null {
  const lower = message.toLowerCase();

  if (/half[\s-]?an?[\s-]?hour/i.test(lower)) return 30;
  if (/quarter[\s-]?hour/i.test(lower)) return 15;

  // "X hours Y minutes"
  const hm = lower.match(/(\d+)\s*h(?:ours?)?\s*(?:and\s*)?(\d+)\s*m(?:in(?:utes?)?)?/);
  if (hm) return parseInt(hm[1]) * 60 + parseInt(hm[2]);

  // Digit + hours
  const dh = lower.match(/(\d+)\s*h(?:ours?|rs?)\b/);
  if (dh) return parseInt(dh[1]) * 60;

  // Digit + minutes
  const dm = lower.match(/(\d+)\s*min(?:utes?)?\b/);
  if (dm) return parseInt(dm[1]);

  // Word number + hours (e.g. "one hour", "an hour", "two hours")
  const whMatch = lower.match(/(\w+)\s+hours?\b/);
  if (whMatch) {
    const n = wordToNum(whMatch[1]);
    if (n !== null) return n * 60;
  }

  // Word number + minutes (e.g. "thirty minutes")
  const wmMatch = lower.match(/(\w+)\s+min(?:utes?)?\b/);
  if (wmMatch) {
    const n = wordToNum(wmMatch[1]);
    if (n !== null) return n;
  }

  return null;
}

// ── Day ───────────────────────────────────────────────────────────────────────
function extractDay(message: string, today: Date): string | null {
  const lower = message.toLowerCase();

  // ASAP family → today
  if (ASAP_RE.test(lower)) return format(today, 'yyyy-MM-dd');

  if (/\btoday\b/.test(lower)) return format(today, 'yyyy-MM-dd');
  if (/\btomorrow\b/.test(lower)) return format(addDays(today, 1), 'yyyy-MM-dd');
  if (/\bday after tomorrow\b/.test(lower)) return format(addDays(today, 2), 'yyyy-MM-dd');

  // this week / next week → Monday of that week
  if (/\bthis week\b/.test(lower)) {
    const dow = today.getDay();
    const monday = addDays(today, dow === 0 ? 1 : 8 - dow); // next Mon if past Mon
    return format(monday, 'yyyy-MM-dd');
  }
  if (/\bnext week\b/.test(lower)) {
    const dow = today.getDay();
    const daysToNextMon = (8 - dow) % 7 || 7;
    return format(addDays(today, daysToNextMon), 'yyyy-MM-dd');
  }

  // Named weekday
  for (let i = 0; i < WEEKDAYS.length; i++) {
    const dayName = WEEKDAYS[i];
    if (!lower.includes(dayName)) continue;
    const currentDow = today.getDay();
    let daysAhead = i - currentDow;
    if (lower.includes(`next ${dayName}`)) {
      daysAhead = daysAhead > 0 ? daysAhead + 7 : daysAhead + 7;
    } else if (lower.includes(`this ${dayName}`)) {
      if (daysAhead < 0) daysAhead += 7;
    } else {
      if (daysAhead <= 0) daysAhead += 7;
    }
    return format(addDays(today, daysAhead), 'yyyy-MM-dd');
  }

  // ISO date literal
  const isoMatch = message.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  // "May 18", "18th May" etc.
  const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (let m = 0; m < MONTHS.length; m++) {
    if (!lower.includes(MONTHS[m])) continue;
    const pat = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s*)?${MONTHS[m]}|${MONTHS[m]}\\s*(\\d{1,2})`);
    const match = lower.match(pat);
    if (match) {
      const dayNum = parseInt(match[1] ?? match[2]);
      const year = today.getFullYear();
      const candidate = new Date(year, m, dayNum);
      if (candidate < today) candidate.setFullYear(year + 1);
      return format(candidate, 'yyyy-MM-dd');
    }
  }

  return null;
}

// ── Time window ───────────────────────────────────────────────────────────────
function extractTimeWindow(message: string): string | null {
  const lower = message.toLowerCase();

  // ASAP → anytime (open schedule)
  if (ASAP_RE.test(lower)) return 'anytime';

  if (/\bmorning\b/.test(lower)) return 'morning';
  if (/\bafternoon\b/.test(lower)) return 'afternoon';
  if (/\b(evening|night)\b/.test(lower)) return 'evening';
  if (/\b(anytime|any\s*time|flexible|doesn'?t matter|don'?t mind|open|whenever)\b/.test(lower)) return 'anytime';

  // Specific hour → map to window
  const timeMatch = lower.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour >= 5  && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17)               return 'evening';
  }

  return null;
}

function extractAttendees(message: string): string[] {
  return message.match(/[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/g) ?? [];
}
