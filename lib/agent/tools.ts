import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const TOOL_SCHEMAS: ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'find_free_slots',
      description:
        "Query the user's calendar for available slots. When the user names a specific time (e.g. 'at 10 AM', '9 to 11'), pass preferredStartTime/preferredEndTime so the tool checks that exact slot and returns blockers plus proximity-ranked alternatives.",
      parameters: {
        type: 'object',
        properties: {
          duration:   { type: 'number', description: 'Meeting duration in minutes (e.g. 30, 60)' },
          day:        { type: 'string', description: 'ISO date string YYYY-MM-DD in the user\'s local timezone' },
          timeWindow: {
            type: 'string',
            enum: ['morning', 'afternoon', 'evening', 'anytime'],
            description: 'Broad search window when no exact time is given',
          },
          preferredStartTime: {
            type: 'string',
            description: 'Exact requested start: "10:00", "10 AM", or ISO UTC. Use when user names a specific time.',
          },
          preferredEndTime: {
            type: 'string',
            description: 'End of requested range if user said "9 to 11" (e.g. "11:00" or "11 AM")',
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
      name: 'plan_multi_day_bookings',
      description:
        'Plan bookings across multiple days at the same local time. Returns which days can auto-book vs which need user picks (one alternative per conflict day). Use for "book every day this week at 10", "Mon–Fri for 1 hour at 2pm", etc.',
      parameters: {
        type: 'object',
        properties: {
          durationMinutes: { type: 'number', description: 'Meeting duration in minutes' },
          days: {
            type: 'array',
            items: { type: 'string' },
            description: 'ISO dates YYYY-MM-DD, one per day to book',
          },
          preferredTime: {
            type: 'string',
            description: 'Local time on each day, e.g. "10:00" or "10 AM"',
          },
        },
        required: ['durationMinutes', 'days', 'preferredTime'],
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
