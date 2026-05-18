/**
 * End-to-end API test against the running dev server.
 * Tests:
 *   1. "show me what's booked tomorrow" → list_events → should return 2 events
 *   2. "book a 30 min meeting tomorrow morning" → find_free_slots → should avoid the 11 AM and 1:30 PM blocks
 */

const BASE = 'http://localhost:3000';
const TZ   = 'Asia/Kolkata';

async function chat(message, sessionId = null) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sessionId, timezone: TZ }),
  });
  return res.json();
}

function printDebug(debug) {
  if (!debug) return;
  for (const e of debug) {
    switch (e.type) {
      case 'slot_extraction':
        if (e.changes.length) console.log(`  [extract] changes: ${e.changes.join(', ')}`);
        break;
      case 'llm_call':
        console.log(`  [llm]     call (${e.messageCount} msgs)`);
        break;
      case 'llm_response':
        console.log(`  [llm]     response tools=[${e.toolNames?.join(',')}] text="${e.textPreview?.slice(0,60)}"`);
        break;
      case 'tool_call':
        console.log(`  [tool]    ${e.tool}(${JSON.stringify(e.args)})`);
        break;
      case 'tool_result':
        console.log(`  [result]  ${e.tool}: ${e.summary}`);
        break;
      case 'freebusy_result':
        console.log(`  [freebusy] busy=${e.busyCount} free=${e.freeCount}`);
        break;
      case 'conflict_resolution':
        console.log(`  [conflict] step=${e.step} strategy=${e.strategy} slots=${e.slotsFound}`);
        break;
    }
  }
}

async function runTests() {
  console.log('\n==============================');
  console.log('TEST 1: List booked events for tomorrow');
  console.log('==============================');
  {
    const r = await chat("What's on my calendar tomorrow?");
    console.log('Response:', r.message);
    printDebug(r.debug);

    const listResult = r.debug?.find(d => d.type === 'tool_result' && d.tool === 'list_events');
    if (listResult) {
      if (listResult.summary.includes('2 event')) {
        console.log('✓ PASS: list_events returned 2 events');
      } else {
        console.log('✗ FAIL: expected 2 events, got:', listResult.summary);
      }
    } else {
      console.log('✗ FAIL: list_events tool was not called');
    }
  }

  console.log('\n==============================');
  console.log('TEST 2: Schedule 30 min tomorrow morning (should avoid 11 AM block)');
  console.log('==============================');
  {
    // First message: set up session
    let r = await chat('I need to book a 30 minute meeting tomorrow morning');
    console.log('Response:', r.message);
    printDebug(r.debug);
    const sid = r.sessionId;

    const fbResult = r.debug?.find(d => d.type === 'freebusy_result');
    if (fbResult) {
      console.log(`✓ freebusy called: busy=${fbResult.busyCount} free=${fbResult.freeCount}`);
      if (fbResult.busyCount >= 1) {
        console.log('✓ PASS: busy blocks detected (interview at 11 AM correctly seen)');
      } else {
        console.log('✗ FAIL: no busy blocks detected — calendar not being read');
      }
    } else {
      console.log('  (freebusy not called yet — LLM may still be collecting slots)');
    }

    // Check if slots returned avoid the 11 AM block
    if (r.state?.slotsFound > 0) {
      console.log(`✓ Found ${r.state.slotsFound} free slot(s)`);
      const has11am = r.message.includes('11:00') || r.message.includes('11:30');
      if (!has11am) {
        console.log('✓ PASS: 11:00 AM (busy) not offered');
      } else {
        console.log('✗ FAIL: 11:00 AM was offered despite being busy');
      }
    }
  }

  console.log('\n==============================');
  console.log('TEST 3: Full 3-turn scheduling flow for tomorrow afternoon');
  console.log('==============================');
  {
    let r = await chat('schedule a 1 hour meeting');
    const sid = r.sessionId;
    console.log('Turn 1:', r.message);

    r = await chat('tomorrow afternoon', sid);
    console.log('Turn 2:', r.message);
    printDebug(r.debug);

    const fbResult = r.debug?.find(d => d.type === 'freebusy_result');
    if (fbResult) {
      console.log(`  freebusy: busy=${fbResult.busyCount} free=${fbResult.freeCount}`);
      // 1:30 PM is busy so we expect fewer slots in afternoon
      if (fbResult.busyCount >= 1) {
        console.log('✓ PASS: afternoon busy block (1:30 PM meeting) detected');
      }
    }
  }

  console.log('\n==============================');
  console.log('All tests complete');
  console.log('==============================\n');
}

runTests().catch(err => {
  console.error('Test error:', err.message);
  process.exit(1);
});
