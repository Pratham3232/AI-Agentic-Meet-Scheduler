import { TimeSlot, WorkingHours } from '@/types';
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

const DEFAULT_TIME_WINDOWS: Record<string, { startHour: number; endHour: number }> = {
  morning:   { startHour: 8,  endHour: 12 },
  afternoon: { startHour: 12, endHour: 17 },
  evening:   { startHour: 17, endHour: 22 },
  anytime:   { startHour: 8,  endHour: 22 },
};

function buildTimeWindows(wh?: WorkingHours): Record<string, { startHour: number; endHour: number }> {
  if (!wh) return DEFAULT_TIME_WINDOWS;
  const midpoint = Math.floor((wh.startHour + wh.endHour) / 2);
  const computed: Record<string, { startHour: number; endHour: number }> = {
    morning:   { startHour: wh.startHour, endHour: midpoint },
    afternoon: { startHour: midpoint,      endHour: Math.min(wh.endHour, 17) },
    evening:   { startHour: Math.max(midpoint, 17), endHour: wh.endHour },
    anytime:   { startHour: wh.startHour, endHour: wh.endHour },
  };
  for (const key of Object.keys(computed)) {
    if (computed[key].startHour >= computed[key].endHour) {
      computed[key] = DEFAULT_TIME_WINDOWS[key];
    }
  }
  return computed;
}

export function getTimeWindowBounds(
  day: string,
  window: string,
  timezone: string = 'UTC',
  now: Date = new Date(),
  workingHours?: WorkingHours
): { start: string; end: string } {
  const windows = buildTimeWindows(workingHours);
  const bounds = windows[window.toLowerCase()] ?? windows.anytime;

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
    if (nextStart < nextEnd) {
      return { start: nextStart.toISOString(), end: nextEnd.toISOString() };
    }
    const fallback = DEFAULT_TIME_WINDOWS[window.toLowerCase()] ?? DEFAULT_TIME_WINDOWS.anytime;
    const fbStart = fromZonedTime(`${nextDayStr}T${String(fallback.startHour).padStart(2, '0')}:00:00`, timezone);
    const fbEnd   = fromZonedTime(`${nextDayStr}T${String(fallback.endHour).padStart(2, '0')}:00:00`, timezone);
    return { start: fbStart.toISOString(), end: fbEnd.toISOString() };
  }

  return {
    start: start.toISOString(),
    end:   end.toISOString(),
  };
}
