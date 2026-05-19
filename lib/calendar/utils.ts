import { TimeSlot } from '@/types';
import { parseISO, addMinutes, addDays } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export function formatTimeSlot(slot: TimeSlot, timezone: string = 'UTC'): string {
  const start = parseISO(slot.start);
  const end = parseISO(slot.end);
  const startFormatted = formatInTimeZone(start, timezone, 'h:mm a');
  const endFormatted = formatInTimeZone(end, timezone, 'h:mm a');
  const dateFormatted = formatInTimeZone(start, timezone, 'EEEE, MMMM d');
  return `${dateFormatted} at ${startFormatted} – ${endFormatted}`;
}

export function formatSlotList(slots: TimeSlot[], timezone: string = 'UTC'): string {
  if (slots.length === 0) return 'No slots available';
  return slots
    .slice(0, 5)
    .map((slot, idx) => `${idx + 1}. ${formatTimeSlot(slot, timezone)}`)
    .join('\n');
}

const TIME_WINDOWS: Record<string, { startHour: number; endHour: number }> = {
  morning:   { startHour: 8,  endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening:   { startHour: 17, endHour: 22 },
  anytime:   { startHour: 8,  endHour: 22 }, // extends to 10 PM
};

/**
 * Returns UTC ISO bounds for a named time window on a given day.
 * If the window start is already in the past, the start is clamped to
 * the next clean 30-min boundary from now so only future slots are returned.
 *
 * @param day      "YYYY-MM-DD" — the date in the user's local timezone
 * @param window   one of morning | afternoon | evening | anytime
 * @param timezone IANA timezone string, e.g. "Asia/Kolkata"
 * @param now      override for "current time" (defaults to new Date())
 */
export function getTimeWindowBounds(
  day: string,
  window: string,
  timezone: string = 'UTC',
  now: Date = new Date()
): { start: string; end: string } {
  const bounds = TIME_WINDOWS[window.toLowerCase()] ?? TIME_WINDOWS.anytime;

  const startZoned = `${day}T${String(bounds.startHour).padStart(2, '0')}:00:00`;
  const endZoned   = `${day}T${String(bounds.endHour).padStart(2, '0')}:00:00`;

  let start = fromZonedTime(startZoned, timezone);
  const end = fromZonedTime(endZoned,   timezone);

  // Clamp start to the next 30-min boundary from now so past slots are excluded
  if (start < now) {
    const mins      = now.getMinutes();
    const remainder = mins % 30;
    const snapped   = remainder === 0 ? new Date(now) : addMinutes(now, 30 - remainder);
    snapped.setSeconds(0, 0);
    start = snapped > start ? snapped : start;
  }

  // If the window has passed entirely (start >= end), roll to next day same window
  if (start >= end) {
    const nextDay = addDays(new Date(day + 'T00:00:00'), 1);
    const nextDayStr = nextDay.toISOString().slice(0, 10);
    const nextStart = fromZonedTime(`${nextDayStr}T${String(bounds.startHour).padStart(2, '0')}:00:00`, timezone);
    const nextEnd   = fromZonedTime(`${nextDayStr}T${String(bounds.endHour).padStart(2, '0')}:00:00`, timezone);
    return { start: nextStart.toISOString(), end: nextEnd.toISOString() };
  }

  return {
    start: start.toISOString(),
    end:   end.toISOString(),
  };
}
