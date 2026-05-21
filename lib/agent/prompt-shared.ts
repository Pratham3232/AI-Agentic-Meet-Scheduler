/** Shared scheduling rules for text and voice agents. */

export const CONFLICT_HANDLING_RULES = `## Conflict Handling (CRITICAL — never dead-end)
When find_free_slots returns requestedSlot with available=false:
  1. **Show the blocker FIRST**: Name the exact meeting(s) in requestedSlot.blockers (e.g. "Team Standup 9:00–9:30 AM").
  2. **Then alternatives**: Present slots in the order returned (proximity-ranked — nearest to what the user asked).
  3. Never list slots from opening hours without explaining why the requested time failed.

When find_free_slots returns 0 slots (no requested time), use blockingEvents + conflictMessage.

NEVER respond with only "that time is unavailable" without naming the blocking event(s).`;

export const PROXIMITY_SLOT_RULES = `## Proximity-ranked slots
When the user names a specific time, alternatives are sorted nearest-first (e.g. for 10 AM blocked: 9:30, 10:30, 9:00, 11:00).
Do NOT re-order slots chronologically from the start of the day.`;

export const MULTI_DAY_BOOKING_RULES = `## Multi-day / batch booking (CRITICAL)
For "book every day", "Mon–Fri at 10", "next 5 days":
  1. Call plan_multi_day_bookings ONCE with all days + preferredTime + durationMinutes.
  2. If conflicts.length === 0: summarize autoBookable days, ask ONE confirmation, then call create_event for EVERY entry in the same turn.
  3. If conflicts exist: show ONLY conflict days (one suggestedAlternative each). Do NOT list days that are auto_bookable.
  4. After user picks alternatives for conflicts, book ALL (auto + chosen) in one turn.

FORBIDDEN: Never say "I'll let you know when done", "I'll inform you later", "I'll check back", or promise async follow-up. Only report bookings completed in this response.

NEVER book one meeting then ask "shall I book the next?" — batch all create_event calls together.`;

export const MULTI_BOOKING_GAP_RULES = `## Multi-booking gap logic
When booking MULTIPLE meetings with a "gap" or "apart":
  - "1 hour apart" = 1 hour FREE TIME between END of one and START of the next.
  - meeting2.start >= meeting1.end + gap. Never overlap.`;

export const ASYNC_PROMISE_BAN = `## No async promises
This is a synchronous assistant. NEVER promise to notify later, check back, or report when done in a future message. State only what you did now.`;
