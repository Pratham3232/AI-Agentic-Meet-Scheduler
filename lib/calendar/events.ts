import { getCalendarClient } from './auth';
import { CalendarEvent } from '@/types';
import { DebugLogger } from '../debug';

export async function createEvent(
  summary: string,
  startTime: string,
  endTime: string,
  attendees: string[] = [],
  description?: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<CalendarEvent> {
  const t0 = Date.now();
  try {
    const calendar = await getCalendarClient();

    const event = {
      summary,
      description,
      start: {
        dateTime: startTime,
        timeZone: 'UTC',
      },
      end: {
        dateTime: endTime,
        timeZone: 'UTC',
      },
      attendees: attendees.map(email => ({ email })),
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

    console.log(`[PERF][calendar] createEvent: ${Date.now() - t0}ms`);
    return response.data as CalendarEvent;
  } catch (error) {
    console.error('Error creating event:', error);
    console.log(`[PERF][calendar] createEvent (error): ${Date.now() - t0}ms`);
    throw error;
  }
}

export async function getEventById(
  eventId: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<CalendarEvent | null> {
  const t0 = Date.now();
  try {
    const calendar = await getCalendarClient();
    const response = await calendar.events.get({ calendarId, eventId });
    console.log(`[PERF][calendar] getEventById: ${Date.now() - t0}ms`);
    return response.data as CalendarEvent;
  } catch {
    console.log(`[PERF][calendar] getEventById (not found): ${Date.now() - t0}ms`);
    return null;
  }
}

/**
 * List all events between two UTC ISO datetimes.
 */
export async function listEvents(
  timeMin: string,
  timeMax: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary',
  debug?: DebugLogger,
  maxResults: number = 50
): Promise<CalendarEvent[]> {
  const t0 = Date.now();
  const calendar = await getCalendarClient();

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults,
  });

  const items = (response.data.items || []) as CalendarEvent[];
  debug?.log({ type: 'tool_result', tool: 'list_events', summary: `${items.length} event(s) found` });
  console.log(`[PERF][calendar] listEvents: ${Date.now() - t0}ms (${items.length})`);
  return items;
}

export async function patchEvent(
  eventId: string,
  startTime: string,
  endTime: string,
  summary?: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<CalendarEvent> {
  const t0 = Date.now();
  const calendar = await getCalendarClient();

  const requestBody: Record<string, unknown> = {
    start: { dateTime: startTime, timeZone: 'UTC' },
    end: { dateTime: endTime, timeZone: 'UTC' },
  };
  if (summary) requestBody.summary = summary;

  const response = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody,
  });

  console.log(`[PERF][calendar] patchEvent: ${Date.now() - t0}ms`);
  return response.data as CalendarEvent;
}

export async function deleteEvent(
  eventId: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<void> {
  const t0 = Date.now();
  const calendar = await getCalendarClient();
  await calendar.events.delete({ calendarId, eventId });
  console.log(`[PERF][calendar] deleteEvent: ${Date.now() - t0}ms`);
}

export async function lookupEvent(
  query: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<CalendarEvent | null> {
  const t0 = Date.now();
  try {
    const calendar = await getCalendarClient();

    const response = await calendar.events.list({
      calendarId,
      q: query,
      maxResults: 10,
      orderBy: 'startTime',
      singleEvents: true,
    });

    const events = response.data.items || [];
    console.log(`[PERF][calendar] lookupEvent: ${Date.now() - t0}ms`);

    if (events.length === 0) {
      return null;
    }

    return events[0] as CalendarEvent;
  } catch (error) {
    console.error('Error looking up event:', error);
    console.log(`[PERF][calendar] lookupEvent (error): ${Date.now() - t0}ms`);
    throw error;
  }
}
