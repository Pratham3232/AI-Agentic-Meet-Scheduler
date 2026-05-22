/** Shared scheduling rules for text and voice agents. */

export const CONFLICT_HANDLING_RULES = `## Conflict Handling (CRITICAL — never dead-end)
When find_free_slots returns requestedSlot with available=false:
  1. **Show the blocker FIRST**: Name the exact meeting(s) in requestedSlot.blockers (e.g. "Team Standup 9:00–9:30 AM").
  2. **Then alternatives**: Present slots in the order returned (proximity-ranked — nearest to what the user asked).
  3. Never list slots from opening hours without explaining why the requested time failed.

When find_free_slots returns 0 slots (no requested time), use blockingEvents + conflictMessage.

When plan_multi_day_bookings returns conflictCount > 0:
  1. For each day in conflicts[], name blockers[] (summary + display) and suggestedAlternative.display when present.
  2. NEVER say "something is blocking" or "there is a conflict" without quoting blockers from the tool result.
  3. If autoBookable.length === 0, do NOT treat it like a single find_free_slots failure — walk conflicts[] or ask the user to pick alternatives per day; check resolvedDays matches what the user asked.

NEVER respond with only "that time is unavailable" without naming the blocking event(s).`;

export const WORKING_HOURS_POLICY = `## Working hours (soft default — explicit time wins)
Working hours apply when the user gives **vague/relative** time only: "morning", "afternoon", "end of day", "ASAP", "sometime next week", "whenever".
When the user names an **explicit** time ("5 AM", "5:00", "17:30", "9 PM"), use that exact time for plan_multi_day_bookings and create_event — even if outside working hours.
Do NOT refuse or tell the user they cannot book outside working hours when they specified a concrete time. Only block if the calendar slot is actually busy.
For vague requests without a specific clock time, search within working hours first.`;

export const BUFFER_AFTER_LAST_MEETING_RULES = `## Buffer after last meeting (same day)
When the user wants decompress/buffer time after their last meeting (e.g. "1 hour after my last meeting", "evening after 7 once I'm done"):
  1. Call find_free_slots with day, timeWindow (e.g. evening), preferredStartTime if they said "after 7 PM", AND bufferAfterLastMeetingMinutes (60 for one hour).
  2. Do NOT ask the user when their last meeting ends — the server reads the calendar.
  3. Present slots from the tool result only; mention earliestAllowedDisplay from the tool if present.`;

export const PROXIMITY_SLOT_RULES = `## Proximity-ranked slots
When the user names a specific time, alternatives are sorted nearest-first (e.g. for 10 AM blocked: 9:30, 10:30, 9:00, 11:00).
Do NOT re-order slots chronologically from the start of the day.`;

export const MULTI_DAY_BOOKING_RULES = `## Multi-day / batch booking (CRITICAL)
For "every weekday next month", "daily at 5 AM", "Mon–Fri at 10", "next Monday to Friday", or "first week of next month":
  1. Call plan_multi_day_bookings ONCE with durationMinutes, preferredTime (exact user time, e.g. "5:00 AM"), dayPattern (monthOffset: 1 + weekdaysOnly for ALL weekdays in next month; week: "first" only for "first week"), OR pass userMessage so the server resolves canonical ISO days[]. For "Monday to Friday" / "next Monday to Friday", always pass userMessage — do NOT invent days[]. Use returned days[] and resolvedDays from the tool — full month is ~20+ weekdays, NOT just 5 days.
  2. Resolve conflicts with user if needed, then exactly ONE confirmation quoting totalDays from the plan. When totalDays > 7, summarize in one sentence (e.g. "22 weekdays in June at 5:00 AM") — do NOT paste displayList line-by-line in chat.
  3. After user confirms → call init_booking_job IMMEDIATELY. Do NOT re-ask "Are you sure?" or re-confirm. The server expands to the full canonical plan if you pass fewer entries. If bookingPlanConfirmed is already true, do NOT re-plan or re-confirm unless the user changes requirements.
  4. After init_booking_job succeeds, the client progress UI books remaining days — do NOT call init_booking_job or execute_booking_batch again in the same turn or while progress is active.
  5. If init_booking_job returns job_already_done while progress is still running, tell the user booking is still in progress in the progress UI — never say "interrupted", "re-initialize", or start a new job. If job_already_done and progress is 100% / pending=0, all meetings are already booked.
  6. Do NOT fire N separate create_event calls for multi-day jobs.
  7. When booking progress shows 100% / "Booking complete" / pending=0, treat ALL items as on the calendar. NEVER call create_event or find_free_slots to "retry" or book one-by-one. If the user asks "are they booked?", answer YES from the job list.
  8. A create_event conflict at the same time as a completed booking job usually means the slot is already yours — do not offer alternative slots unless the user asks to change the plan.

FORBIDDEN: Never say "I'll let you know when done", "I'll inform you later", "I'll check back", or promise async follow-up. Only report bookings completed in this response.

BATCH COMPLETION LANGUAGE (CRITICAL — check done field FIRST):
- If execute_booking_batch returns done=true → say "All X meetings booked." STOP. Do NOT say "started", "in progress", "rest will complete", or any incomplete language.
- If execute_booking_batch returns done=false → say "Booking started — X booked so far, the rest will complete automatically."
- VOICE: summary MUST match: done=true → "All X meetings are booked." / done=false → "Booking started, rest will complete automatically."

NEVER book one meeting then ask "shall I book the next?" — use the booking job flow.

Do NOT say a multi-day meeting is booked until execute_booking_batch returns done=true OR booking progress shows pending=0 AND booked equals total (booked > 0).
If booking progress shows 0% or booked=0, booking has NOT completed — never say "all meetings are booked" from the plan summary alone.

Single-day booking: one create_event after slot confirmation — immediate "Booked …" message.`;

export const BULK_CANCEL_RULES = `## Bulk cancel / delete many (CRITICAL)
For "cancel all this month/week", "delete everything listed", "clear my calendar for …":
  1. Call list_events once for the stated range (server returns all pages).
  2. ONE confirmation with count + range only (e.g. "Cancel all 34 events in May?"). When count > 7, do NOT paste every title in chat or voice.
  3. After user confirms → call init_cancel_job IMMEDIATELY with all event IDs. Do NOT re-confirm.
  4. Call execute_cancel_batch at most ONCE. Client SSE finishes the rest — do NOT call delete_event per event.
  5. If init_cancel_job returns job_already_done, tell the user cancellations are already done.
  6. NEVER say "I'll cancel one by one" or "I'll let you know when done".
  7. CANCEL BATCH COMPLETION LANGUAGE (CRITICAL — check done field FIRST):
     - If execute_cancel_batch returns done=true → say "All X events cancelled." STOP. Do NOT say "started", "in progress", or any incomplete language.
     - If execute_cancel_batch returns done=false → say "Cancellation started — X cancelled so far, the rest will complete automatically."
     - VOICE: summary MUST match: done=true → "All X events cancelled." / done=false → "Cancellation started, rest will complete automatically."
Single-event cancel: one match → delete_event immediately (no second confirmation).
CRITICAL: Only confirm a deletion happened AFTER delete_event returned {success: true}. If you did not call delete_event, the event is NOT cancelled.`;

export const RESCHEDULE_WORKFLOW_RULES = `## Reschedule / move (mandatory order)
1. identify_event(timeMin/timeMax for the stated day, timeHint + summaryHint from the user message).
2. If ambiguous → list numbered matches, ask user to pick (no reschedule yet).
3. If single bestMatch + new times known → ONE confirmation: "Move [summary] from [old] to [new]?"
4. On user yes → reschedule_event(eventId, confirmed=true, …).
5. **Relative moves** ("30 minutes earlier/later", "half an hour later"): use shiftMinutes (-30, +30, etc.) — do NOT hand-compute newStartTime/newEndTime ISO strings.
6. **Absolute moves** ("move to 3 PM"): pass newStartTime and newEndTime from identify_event or calendar display.
7. NEVER use lookup_event alone for time-based references ("4 to 7", "the meeting I just booked").
8. If user says "the one you just booked" and session has bookingJob booked items, use summaryHint + timeHint from the last booked item.
9. For a second reschedule of the same meeting, use lastRescheduledEvent.eventId from session OR call identify_event with timeHint at the **current** slot (not the original time).
10. If reschedule_event returns job_already_done or event not found, call list_events for that day before retrying.

Do NOT delete_event + create_event manually for reschedule — use reschedule_event.`;

export const MULTI_BOOKING_GAP_RULES = `## Multi-booking gap logic
When booking MULTIPLE meetings with a "gap" or "apart":
  - "1 hour apart" = 1 hour FREE TIME between END of one and START of the next.
  - meeting2.start >= meeting1.end + gap. Never overlap.`;

export const ASYNC_PROMISE_BAN = `## No async promises
This is a synchronous assistant. NEVER promise to notify later, check back, or report when done in a future message. State only what you did now.`;
