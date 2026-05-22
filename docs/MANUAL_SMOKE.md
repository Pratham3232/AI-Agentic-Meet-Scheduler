# Manual smoke checklist (multi-day booking)

Run after changes to booking flow, progress UI, or session/SSE logic.

## Prerequisites

- Google Calendar connected
- Dev server: `npm run dev`
- Working hours configured in UI if testing vague-time behavior

## Scenarios

### 1. Full-month weekdays (text)

1. Send: `Book Yoga at 5 AM every weekday next month`.
2. Confirm plan shows ~20+ days (one-line summary, not 30 listed dates).
3. Confirm once; verify rail shows many dots (not 5).
4. Wait for completion; rail reaches 100%, counters match.

### 2. Voice same flow

1. Start voice; same request and confirm.
2. One assistant bubble with rail; progress advances without duplicate cards.

### 3. Concurrent SSE

1. Start a 10+ day booking.
2. Open a second tab with the same session (or double-submit if applicable).
3. Second run should not reset progress to 0% (duplicate blocked).

### 4. Second booking same session

1. Complete a multi-day job (100%).
2. Start a new single-day or multi-day booking in the same chat (no refresh).
3. New rail/job should appear and advance (not stuck on previous 100%).

### 5. Conflict day

1. Block a slot on one target day in Google Calendar.
2. Plan multi-day including that day.
3. Assistant shows conflict + alternative; after pick, init books all days including resolution.

### 6. Stale SSE recovery (optional)

1. Simulate crash: stop server mid-booking with `sseInProgress` left true in Redis.
2. Wait 10+ minutes or manually set old `updatedAt` on session job.
3. Retry booking run; job should proceed (lock cleared).

### 7. Bulk cancel (text)

1. Send: `Cancel all my meetings this month` (or list range then `cancel all`).
2. Confirm once with count only (not 34 lines in chat).
3. Rail shows cancellation progress to 100%.
4. Calendar events removed; assistant does not offer one-by-one delete.

### 8. Bulk cancel (voice)

1. Same as §7 in voice mode.
2. No `Conversation already has an active response in progress` in chat errors.

### 9. Voice response gate

1. List week → `reschedule all yoga to 6am` → confirm.
2. No duplicate `response.create` errors mid-flow.
3. Optional: say `yes` while assistant is still speaking; no DC error.

## Pass criteria

- No duplicate progress cards at 100%
- Booked count on rail matches calendar events
- No re-init loop after success (`job_already_done` only as message, not new 0% job)
- Bulk cancel completes via rail without serial `delete_event` in voice
- No Realtime `active response in progress` errors during multi-tool turns
