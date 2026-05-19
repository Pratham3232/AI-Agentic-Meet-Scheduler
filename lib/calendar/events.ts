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

    return response.data as CalendarEvent;
  } catch (error) {
    console.error('Error creating event:', error);
    throw error;
  }
}

/**
 * List all events between two UTC ISO datetimes.
 * Used to answer "what's on my calendar tomorrow?" queries.
 */
export async function listEvents(
  timeMin: string,
  timeMax: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary',
  debug?: DebugLogger
): Promise<CalendarEvent[]> {
  const calendar = await getCalendarClient();

  const response = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });

  const items = (response.data.items || []) as CalendarEvent[];
  debug?.log({ type: 'tool_result', tool: 'list_events', summary: `${items.length} event(s) found` });
  return items;
}

export async function deleteEvent(
  eventId: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<void> {
  const calendar = await getCalendarClient();
  await calendar.events.delete({ calendarId, eventId });
}

export async function lookupEvent(
  query: string,
  calendarId: string = process.env.GOOGLE_CALENDAR_ID || 'primary'
): Promise<CalendarEvent | null> {
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
    
    if (events.length === 0) {
      return null;
    }

    return events[0] as CalendarEvent;
  } catch (error) {
    console.error('Error looking up event:', error);
    throw error;
  }
}
