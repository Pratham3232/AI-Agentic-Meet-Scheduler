import { ConversationState } from '@/types';
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/**
 * Builds the session.update event payload for the OpenAI Realtime API.
 * Contains system instructions + tool definitions.
 */
export function buildRealtimeSessionConfig(state: ConversationState, timezone: string = 'UTC') {
  const now      = new Date();
  const today    = format(now, 'yyyy-MM-dd');
  const todayDay = format(now, 'EEEE');
  const nowLocal = formatInTimeZone(now, timezone, 'h:mm a');

  const instructions = `You are a smart, concise scheduling assistant. Your job: collect the minimum info needed (meeting duration, day, and time window), query the calendar, and book a meeting.

Rules:
1. Before asking for anything, check if the user already provided it. Users often pack everything in one sentence ("one hour meeting ASAP").
2. Natural language mappings: "as soon as possible" / "ASAP" / "soonest" / "right now" → day=today (${today}), window=anytime. "one hour" / "an hour" → 60 min. "half an hour" → 30 min.
3. Ask for at most ONE missing piece per turn.
4. Call find_free_slots as soon as duration + day + window are all known.
5. Never invent time slots — only present what find_free_slots returns.
6. Always confirm the exact slot before calling create_event.
7. To answer "what's on my calendar?" queries, use list_events (not lookup_event).
8. Keep replies short and conversational.
9. Never suggest a time slot before ${nowLocal} today.

Context:
- Today: ${today} (${todayDay})
- Current time: ${nowLocal}
- User timezone: ${timezone}`;

  const tools = [
    {
      type: 'function' as const,
      name: 'find_free_slots',
      description: "Query the user's calendar for available slots in a given time window",
      parameters: {
        type: 'object',
        properties: {
          duration:   { type: 'number', description: 'Meeting duration in minutes' },
          day:        { type: 'string', description: 'ISO date string YYYY-MM-DD' },
          timeWindow: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'anytime'], description: 'Time of day' },
        },
        required: ['duration', 'day', 'timeWindow'],
      },
    },
    {
      type: 'function' as const,
      name: 'create_event',
      description: 'Book a meeting after user confirms a specific slot',
      parameters: {
        type: 'object',
        properties: {
          summary:     { type: 'string', description: 'Meeting title' },
          startTime:   { type: 'string', description: 'ISO datetime UTC for start' },
          endTime:     { type: 'string', description: 'ISO datetime UTC for end' },
          attendees:   { type: 'array', items: { type: 'string' }, description: 'Attendee emails' },
          description: { type: 'string', description: 'Optional description' },
        },
        required: ['summary', 'startTime', 'endTime'],
      },
    },
    {
      type: 'function' as const,
      name: 'list_events',
      description: 'List calendar events between two UTC datetimes',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'Start of range (UTC ISO)' },
          timeMax: { type: 'string', description: 'End of range (UTC ISO)' },
        },
        required: ['timeMin', 'timeMax'],
      },
    },
    {
      type: 'function' as const,
      name: 'lookup_event',
      description: 'Search calendar for an event by name',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Event name or keywords' },
        },
        required: ['query'],
      },
    },
  ];

  return {
    type: 'session.update',
    session: {
      instructions,
      tools,
      tool_choice: 'auto',
      input_audio_transcription: { model: 'whisper-1' },
    },
  };
}
