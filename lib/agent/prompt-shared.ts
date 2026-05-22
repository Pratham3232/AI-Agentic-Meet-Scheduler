/** Shared scheduling rules for text and voice agents. */

export const CONFLICT_HANDLING_RULES = `## Conflict Handling (CRITICAL — never dead-end)
When find_free_slots returns requestedSlot with available=false:
  1. **Show the blocker FIRST**: Name the exact meeting(s) in requestedSlot.blockers (e.g. "Team Standup 9:00–9:30 AM").
  2. **Then alternatives**: Present slots in the order returned (proximity-ranked — nearest to what the user asked).
  3. Never list slots from opening hours without explaining why the requested time failed.

When find_free_slots returns 0 slots (no requested time), use blockingEvents + conflictMessage.

NEVER respond with only "that time is unavailable" without naming the blocking event(s).`;

export const WORKING_HOURS_POLICY = `## Working hours (soft default — explicit time wins)
Working hours apply when the user gives **vague/relative** time only: "morning", "afternoon", "end of day", "ASAP", "sometime next week", "whenever".
When the user names an **explicit** time ("5 AM", "5:00", "17:30", "9 PM"), use that exact time for plan_multi_day_bookings and create_event — even if outside working hours.
Do NOT refuse or tell the user they cannot book outside working hours when they specified a concrete time. Only block if the calendar slot is actually busy.
For vague requests without a specific clock time, search within working hours first.`;

export const PROXIMITY_SLOT_RULES = `## Proximity-ranked slots
When the user names a specific time, alternatives are sorted nearest-first (e.g. for 10 AM blocked: 9:30, 10:30, 9:00, 11:00).
Do NOT re-order slots chronologically from the start of the day.`;

export const MULTI_DAY_BOOKING_RULES = `## Multi-day / batch booking (CRITICAL)
For "every weekday next month", "daily at 5 AM", "Mon–Fri at 10", or "first week of next month":
  1. Call plan_multi_day_bookings ONCE with durationMinutes, preferredTime (exact user time, e.g. "5:00 AM"), dayPattern (monthOffset: 1 + weekdaysOnly for ALL weekdays in next month; week: "first" only for "first week"), OR pass userMessage so the server resolves canonical ISO days[]. Use returned days[] length — full month is ~20+ weekdays, NOT just 5 days.
  2. Resolve conflicts with user if needed, then exactly ONE confirmation quoting totalDays from the plan. When totalDays > 7, summarize in one sentence (e.g. "22 weekdays in June at 5:00 AM") — do NOT paste displayList line-by-line in chat.
  3. After user confirms, call init_booking_job once with all autoBookable entries (all days in plan). The server expands to the full canonical plan if you pass fewer entries. If bookingPlanConfirmed is already true, do NOT re-plan or re-confirm unless the user changes requirements.
  4. Call execute_booking_batch at most ONCE (optional, ≤5 items). Remaining pending days are booked by the client progress UI — do NOT call init_booking_job or execute_booking_batch again after success.
  5. If init_booking_job returns job_already_done, tell the user all meetings are already booked — never re-initialize or show a new 0% progress job.
  6. Do NOT fire N separate create_event calls for multi-day jobs.

FORBIDDEN: Never say "I'll let you know when done", "I'll inform you later", "I'll check back", or promise async follow-up. Only report bookings completed in this response.

NEVER book one meeting then ask "shall I book the next?" — use the booking job flow.

Single-day booking: one create_event after slot confirmation — immediate "Booked …" message.`;

export const RESCHEDULE_WORKFLOW_RULES = `## Reschedule / move (mandatory order)
1. identify_event(timeMin/timeMax for the stated day, timeHint + summaryHint from the user message).
2. If ambiguous → list numbered matches, ask user to pick (no reschedule yet).
3. If single bestMatch + new times known → ONE confirmation: "Move [summary] from [old] to [new]?"
4. On user yes → reschedule_event(eventId, newStart, newEnd, confirmed=true).
5. NEVER use lookup_event alone for time-based references ("4 to 7", "the meeting I just booked").
6. If user says "the one you just booked" and session has bookingJob booked items, use summaryHint + timeHint from the last booked item.
7. For a second reschedule of the same meeting, use lastRescheduledEvent.eventId from session OR call identify_event with timeHint at the **current** slot (not the original time).
8. If reschedule_event returns job_already_done or event not found, call list_events for that day before retrying.

Do NOT delete_event + create_event manually for reschedule — use reschedule_event.`;

export const MULTI_BOOKING_GAP_RULES = `## Multi-booking gap logic
When booking MULTIPLE meetings with a "gap" or "apart":
  - "1 hour apart" = 1 hour FREE TIME between END of one and START of the next.
  - meeting2.start >= meeting1.end + gap. Never overlap.`;

export const ASYNC_PROMISE_BAN = `## No async promises
This is a synchronous assistant. NEVER promise to notify later, check back, or report when done in a future message. State only what you did now.`;
