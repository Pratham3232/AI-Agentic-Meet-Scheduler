import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const TOOL_SCHEMAS: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'find_free_slots',
      description: "Query the user's calendar for available slots in a given time window",
      parameters: {
        type: 'object',
        properties: {
          duration:   { type: 'number', description: 'Meeting duration in minutes (e.g. 30, 60)' },
          day:        { type: 'string', description: 'ISO date string YYYY-MM-DD in the user\'s local timezone' },
          timeWindow: {
            type: 'string',
            enum: ['morning', 'afternoon', 'evening', 'anytime'],
            description: 'morning=8-12, afternoon=12-17, evening=17-21, anytime=8-18',
          },
        },
        required: ['duration', 'day', 'timeWindow'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_event',
      description: 'Book the meeting on the calendar once the user confirms a specific slot',
      parameters: {
        type: 'object',
        properties: {
          summary:     { type: 'string', description: 'Meeting title' },
          startTime:   { type: 'string', description: 'ISO datetime (UTC) for meeting start' },
          endTime:     { type: 'string', description: 'ISO datetime (UTC) for meeting end' },
          attendees:   { type: 'array', items: { type: 'string' }, description: 'List of attendee email addresses' },
          description: { type: 'string', description: 'Optional description or agenda' },
        },
        required: ['summary', 'startTime', 'endTime'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_events',
      description: 'List all calendar events between two UTC datetimes — use this to answer "what do I have scheduled?" or "show my bookings for tomorrow"',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'Start of range as UTC ISO datetime (inclusive)' },
          timeMax: { type: 'string', description: 'End of range as UTC ISO datetime (exclusive)' },
        },
        required: ['timeMin', 'timeMax'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'lookup_event',
      description: 'Search the calendar for an existing event by name — used to resolve relative references like "the day after my kickoff"',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Event name or keywords to search for' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_event',
      description: 'Delete a calendar event by its ID. Use when rescheduling (delete old, then create new) or when the user asks to cancel/remove a meeting.',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'The event ID returned by list_events or lookup_event' },
        },
        required: ['eventId'],
        additionalProperties: false,
      },
    },
  },
];
