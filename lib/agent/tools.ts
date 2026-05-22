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
          dayPattern: {
            type: 'object',
            properties: {
              monthOffset: { type: 'number', description: '0=this month, 1=next month' },
              weekdaysOnly: { type: 'boolean', description: 'Mon–Fri within resolved week' },
              week: { type: 'string', enum: ['first', 'last'], description: 'First or last week of month' },
              month: { type: 'number', description: 'Target month 1-12 (e.g. 7 for July)' },
              year: { type: 'number', description: 'Target year (defaults to current)' },
            },
          },
          userMessage: {
            type: 'string',
            description: 'Optional user text for server day resolution (e.g. first week of next month Mon–Fri)',
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
      name: 'init_booking_job',
      description:
        'Initialize a multi-day booking job with all entries to book. Call after user confirms the plan. Do not use create_event for each day — use execute_booking_batch instead.',
      parameters: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'string', description: 'ISO date YYYY-MM-DD' },
                start: { type: 'string', description: 'UTC ISO start datetime' },
                end: { type: 'string', description: 'UTC ISO end datetime' },
                summary: { type: 'string', description: 'Meeting title' },
              },
              required: ['day', 'start', 'end', 'summary'],
            },
            description: 'All days/times to book',
          },
          force: {
            type: 'boolean',
            description: 'Set true only if user explicitly asks to restart a completed job',
          },
        },
        required: ['entries'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'execute_booking_batch',
      description:
        'Book the next batch of pending items from the active booking job (default 5). Call once after init_booking_job; the client auto-continues via SSE for the rest.',
      parameters: {
        type: 'object',
        properties: {
          batchSize: {
            type: 'number',
            description: 'Number of pending items to book this call (default 5)',
          },
        },
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
      name: 'identify_event',
      description:
        'Find calendar events in a time range by local time hint and/or title. Always lists events server-side — use for reschedule ("4 to 7", "the 10am meeting"). Never use lookup_event alone for time-based references.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: { type: 'string', description: 'UTC ISO start of search window (inclusive)' },
          timeMax: { type: 'string', description: 'UTC ISO end of search window (exclusive)' },
          timeHint: { type: 'string', description: 'Optional local time range e.g. "4 to 7", "4pm-7pm"' },
          summaryHint: { type: 'string', description: 'Optional title keywords e.g. "standup"' },
          day: { type: 'string', description: 'Optional ISO date YYYY-MM-DD for clarity' },
        },
        required: ['timeMin', 'timeMax'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'reschedule_event',
      description:
        'Reschedule an event by ID from identify_event. Set confirmed=false for preview; confirmed=true after user says yes (deletes old, creates new).',
      parameters: {
        type: 'object',
        properties: {
          eventId: { type: 'string', description: 'Event ID from identify_event' },
          newStartTime: { type: 'string', description: 'New start UTC ISO' },
          newEndTime: { type: 'string', description: 'New end UTC ISO' },
          confirmed: { type: 'boolean', description: 'false = preview only; true = execute' },
        },
        required: ['eventId', 'newStartTime', 'newEndTime', 'confirmed'],
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
