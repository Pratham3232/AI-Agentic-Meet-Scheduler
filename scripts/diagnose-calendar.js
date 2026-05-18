const { google } = require('googleapis');
require('dotenv').config({ path: '.env.local' });

const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';
const USER_TZ = 'Asia/Kolkata';

async function run() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'http://localhost:3000'
  );
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: 'v3', auth });

  // Tomorrow full day in IST  →  UTC
  const { fromZonedTime } = require('date-fns-tz');
  const tomorrowISO = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  })();

  const dayStart = fromZonedTime(`${tomorrowISO}T00:00:00`, USER_TZ);
  const dayEnd   = fromZonedTime(`${tomorrowISO}T23:59:59`, USER_TZ);

  console.log('\n=== DIAGNOSTIC ===');
  console.log(`Calendar ID : ${CALENDAR_ID}`);
  console.log(`Tomorrow    : ${tomorrowISO} (${USER_TZ})`);
  console.log(`UTC window  : ${dayStart.toISOString()} → ${dayEnd.toISOString()}`);

  // ── 1. List Events (shows actual event titles + times) ────────────────────
  console.log('\n--- calendar.events.list ---');
  try {
    const evRes = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: dayStart.toISOString(),
      timeMax: dayEnd.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    const events = evRes.data.items || [];
    if (events.length === 0) {
      console.log('  ⚠  No events found for tomorrow in calendar:', CALENDAR_ID);
    } else {
      events.forEach((e, i) => {
        console.log(`  ${i + 1}. "${e.summary}" — ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date}`);
      });
    }
  } catch (err) {
    console.error('  ERROR listing events:', err.message);
    if (err.message?.includes('invalid_grant')) {
      console.error('  → Refresh token is expired. Run: npm run auth:google');
    }
  }

  // ── 2. Freebusy (what find_free_slots actually uses) ─────────────────────
  console.log('\n--- calendar.freebusy.query ---');
  try {
    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: dayStart.toISOString(),
        timeMax: dayEnd.toISOString(),
        items: [{ id: CALENDAR_ID }],
        timeZone: 'UTC',
      },
    });
    const busy = fbRes.data.calendars?.[CALENDAR_ID]?.busy || [];
    const errors = fbRes.data.calendars?.[CALENDAR_ID]?.errors || [];
    if (errors.length > 0) {
      console.error('  Calendar errors:', JSON.stringify(errors));
    }
    if (busy.length === 0) {
      console.log('  ⚠  Freebusy returned 0 busy slots for tomorrow');
    } else {
      console.log(`  ✓ ${busy.length} busy block(s):`);
      busy.forEach((b, i) => console.log(`    ${i + 1}. ${b.start} → ${b.end}`));
    }
  } catch (err) {
    console.error('  ERROR freebusy:', err.message);
  }

  // ── 3. Simulate find_free_slots for morning ───────────────────────────────
  console.log('\n--- Simulated findFreeSlots (morning window, 30 min) ---');
  try {
    const winStart = fromZonedTime(`${tomorrowISO}T08:00:00`, USER_TZ);
    const winEnd   = fromZonedTime(`${tomorrowISO}T12:00:00`, USER_TZ);
    console.log(`  Query: ${winStart.toISOString()} → ${winEnd.toISOString()}`);

    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: winStart.toISOString(),
        timeMax: winEnd.toISOString(),
        items: [{ id: CALENDAR_ID }],
        timeZone: 'UTC',
      },
    });
    const busy = fbRes.data.calendars?.[CALENDAR_ID]?.busy || [];
    console.log(`  Busy blocks in morning window: ${busy.length}`);
    busy.forEach(b => console.log(`    busy: ${b.start} → ${b.end}`));
  } catch (err) {
    console.error('  ERROR:', err.message);
  }

  console.log('\n=== END DIAGNOSTIC ===\n');
}

run().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
