import { findFreeSlots, findAllFreeSlotsInWindow, rankSlotsByProximity, filterFutureSlots, isSlotFree, eventsOverlappingRange, parsePreferredTime } from '@/lib/calendar/slot-search';
import { getTimeWindowBounds, formatTimeSlot } from '@/lib/calendar/utils';
import { listEvents } from '@/lib/calendar/events';
import { resolveConflict } from '@/lib/agent/conflict-resolver';
import { DebugLogger } from '@/lib/debug';
import { SearchParams, TimeSlot, WorkingHours } from '@/types';
import { addMinutes, parseISO } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';

export interface FindFreeSlotsArgs {
  duration: number;
  day: string;
  timeWindow: string;
  preferredStartTime?: string;
  preferredEndTime?: string;
  /** Earliest slot start = last meeting end on day + this many minutes */
  bufferAfterLastMeetingMinutes?: number;
}

export interface FindFreeSlotsResult {
  slots: TimeSlot[];
  slotsFound: number;
  conflictStrategy: string | null;
  conflictMessage: string | null;
  blockingEvents?: Array<{ summary: string; start: string; end: string; display: string }>;
  requestedSlot?: {
    available: boolean;
    display: string;
    start: string;
    end: string;
    blockers: Array<{ summary: string; display: string }>;
  };
  hint?: string;
  earliestAllowedDisplay?: string;
  searchParams: SearchParams & { preferredStartTime?: string; preferredEndTime?: string };
}

async function clampSearchWindow(
  bounds: { start: string; end: string },
  args: FindFreeSlotsArgs,
  timezone: string,
  debug: DebugLogger,
  now: Date
): Promise<{ start: string; end: string; earliestAllowedDisplay?: string; bufferHint?: string }> {
  let start = parseISO(bounds.start);
  const end = parseISO(bounds.end);
  let earliestAllowedDisplay: string | undefined;
  let bufferHint: string | undefined;

  const buffer = args.bufferAfterLastMeetingMinutes;
  if (buffer !== undefined && buffer > 0) {
    const dayStartIso = fromZonedTime(`${args.day}T00:00:00`, timezone).toISOString();
    const dayEndIso = fromZonedTime(`${args.day}T23:59:59`, timezone).toISOString();
    const events = await listEvents(dayStartIso, dayEndIso, undefined, debug);
    let lastEndMs = 0;
    for (const e of events) {
      const endDt = e.end?.dateTime;
      if (!endDt) continue;
      const ms = parseISO(endDt).getTime();
      if (ms > lastEndMs) lastEndMs = ms;
    }
    if (lastEndMs > 0) {
      const earliest = addMinutes(new Date(lastEndMs), buffer);
      if (earliest > start) {
        start = earliest;
        earliestAllowedDisplay = formatTimeSlot(
          { start: earliest.toISOString(), end: addMinutes(earliest, 30).toISOString() },
          timezone
        );
        bufferHint = `Earliest start after last meeting + ${buffer} min buffer: ${earliestAllowedDisplay}. Do not ask the user when their last meeting ends.`;
      }
    }
  }

  const preferredInput = args.preferredStartTime ?? args.preferredEndTime;
  if (preferredInput) {
    const timeStr =
      args.preferredStartTime && args.preferredEndTime
        ? `${args.preferredStartTime} to ${args.preferredEndTime}`
        : preferredInput;
    const parsed = parsePreferredTime(timeStr, args.day, timezone);
    if (parsed && parseISO(parsed.start) > start) {
      start = parseISO(parsed.start);
    }
  }

  if (start >= end) {
    return {
      start: bounds.start,
      end: bounds.end,
      earliestAllowedDisplay,
      bufferHint: bufferHint ?? 'No room in window after buffer and preferred time.',
    };
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    earliestAllowedDisplay,
    bufferHint,
  };
}

export async function executeFindFreeSlots(
  args: FindFreeSlotsArgs,
  timezone: string,
  debug: DebugLogger,
  workingHours?: WorkingHours,
  now: Date = new Date()
): Promise<FindFreeSlotsResult> {
  const { duration, day, timeWindow, preferredStartTime, preferredEndTime } = args;
  const rawBounds = getTimeWindowBounds(day, timeWindow, timezone, now, workingHours);
  const clamped = await clampSearchWindow(rawBounds, args, timezone, debug, now);
  const bounds = { start: clamped.start, end: clamped.end };
  const bufferHint = clamped.bufferHint;
  const earliestAllowedDisplay = clamped.earliestAllowedDisplay;

  let conflictStrategy: string | null = null;
  let conflictMessage: string | null = null;
  let blockingEvents: Array<{ summary: string; start: string; end: string; display: string }> = [];
  let requestedSlot: FindFreeSlotsResult['requestedSlot'];
  let hint: string | undefined;

  const preferredInput = preferredStartTime ?? preferredEndTime;
  let anchor: Date | null = null;
  let requestedStart = '';
  let requestedEnd = '';

  if (preferredInput) {
    const timeStr =
      preferredStartTime && preferredEndTime
        ? `${preferredStartTime} to ${preferredEndTime}`
        : preferredStartTime ?? preferredEndTime ?? '';
    const parsed = parsePreferredTime(timeStr, day, timezone);
    if (parsed) {
      anchor = parsed.anchor;
      requestedStart = parsed.start;
      if (parsed.end) {
        requestedEnd = parsed.end;
      } else {
        requestedEnd = addMinutes(parseISO(requestedStart), duration).toISOString();
      }
    }
  }

  if (anchor && requestedStart && requestedEnd) {
    const available = await isSlotFree(requestedStart, requestedEnd);
    const searchBounds = bounds;
    const allInWindow = filterFutureSlots(
      await findAllFreeSlotsInWindow(searchBounds.start, searchBounds.end, duration, undefined),
      now
    );
    const ranked = rankSlotsByProximity(anchor, allInWindow).slice(0, 5);

    const existingEvents = await listEvents(requestedStart, requestedEnd, undefined, debug);
    const overlapping = eventsOverlappingRange(existingEvents, requestedStart, requestedEnd);
    const blockers = overlapping
      .filter(e => e.start?.dateTime && e.end?.dateTime)
      .map(e => ({
        summary: e.summary ?? '(no title)',
        display: formatTimeSlot(
          { start: e.start!.dateTime!, end: e.end!.dateTime! },
          timezone
        ),
      }));

    requestedSlot = {
      available,
      display: formatTimeSlot({ start: requestedStart, end: requestedEnd }, timezone),
      start: requestedStart,
      end: requestedEnd,
      blockers,
    };

    if (!available && blockers.length === 0) {
      const windowEvents = await listEvents(bounds.start, bounds.end, undefined, debug);
      const windowOverlapping = eventsOverlappingRange(windowEvents, requestedStart, requestedEnd);
      requestedSlot.blockers = windowOverlapping
        .filter(e => e.start?.dateTime && e.end?.dateTime)
        .map(e => ({
          summary: e.summary ?? '(no title)',
          display: formatTimeSlot(
            { start: e.start!.dateTime!, end: e.end!.dateTime! },
            timezone
          ),
        }));
    }

    hint = [
      bufferHint,
      available
        ? `User asked for ${requestedSlot.display}. That time is available — confirm before booking.`
        : `User asked for ${requestedSlot.display}. It is NOT available. Lead with blockers: ${requestedSlot.blockers.map(b => b.summary).join(', ') || 'existing meeting'}. Then offer nearest alternatives in order.`,
    ]
      .filter(Boolean)
      .join(' ');

    return {
      slots: ranked,
      slotsFound: ranked.length,
      conflictStrategy: available ? null : 'requested_time_unavailable',
      conflictMessage: available
        ? null
        : `${requestedSlot.display} is not available.`,
      blockingEvents: requestedSlot.blockers.length
        ? requestedSlot.blockers.map(b => ({
            summary: b.summary,
            start: requestedStart,
            end: requestedEnd,
            display: b.display,
          }))
        : undefined,
      requestedSlot,
      hint,
      earliestAllowedDisplay,
      searchParams: { duration, day, timeWindow, preferredStartTime, preferredEndTime },
    };
  }

  // No preferred time: search window, rank by midpoint or now
  let slots = filterFutureSlots(
    await findFreeSlots(bounds.start, bounds.end, duration, undefined, debug),
    now
  );

  const windowMid = parseISO(bounds.start).getTime() + (parseISO(bounds.end).getTime() - parseISO(bounds.start).getTime()) / 2;
  const rankAnchor = new Date(Math.max(windowMid, now.getTime()));
  if (slots.length > 1) {
    slots = rankSlotsByProximity(rankAnchor, slots).slice(0, 5);
  }

  if (slots.length === 0) {
    const existingEvents = await listEvents(bounds.start, bounds.end, undefined, debug);
    blockingEvents = existingEvents
      .filter(e => e.start?.dateTime && e.end?.dateTime)
      .map(e => ({
        summary: e.summary ?? '(no title)',
        start: e.start!.dateTime!,
        end: e.end!.dateTime!,
        display: formatTimeSlot({ start: e.start!.dateTime!, end: e.end!.dateTime! }, timezone),
      }));

    const conflict = await resolveConflict({ duration, day, timeWindow }, debug, timezone, workingHours);
    slots = filterFutureSlots(conflict.slots, now);
    if (anchor) {
      slots = rankSlotsByProximity(anchor, slots).slice(0, 5);
    }
    conflictStrategy = conflict.strategy;
    conflictMessage = conflict.message;
  }

  const generalHint = bufferHint
    ? bufferHint
    : undefined;

  return {
    slots,
    slotsFound: slots.length,
    conflictStrategy,
    conflictMessage,
    blockingEvents: blockingEvents.length > 0 ? blockingEvents : undefined,
    requestedSlot,
    hint: generalHint,
    earliestAllowedDisplay,
    searchParams: { duration, day, timeWindow, preferredStartTime, preferredEndTime },
  };
}
