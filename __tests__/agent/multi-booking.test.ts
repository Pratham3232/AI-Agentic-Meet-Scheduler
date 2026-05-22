import { resolvePlanDays } from '@/lib/agent/multi-booking';

const TZ = 'America/New_York';
const TODAY = new Date('2026-05-21T12:00:00Z');

describe('resolvePlanDays', () => {
  test('prefers server parse over short LLM days[] for next month weekdays', () => {
    const llmDays = [
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ];
    const resolved = resolvePlanDays(llmDays, TZ, {
      userMessage: 'book yoga next month weekdays 5am',
    }, TODAY);
    expect(resolved.length).toBeGreaterThanOrEqual(20);
    expect(resolved).not.toEqual(llmDays);
  });

  test('prefers server parse over longer incorrect LLM days[]', () => {
    const llmDays = Array.from({ length: 30 }, (_, i) => {
      const d = String(i + 1).padStart(2, '0');
      return `2026-06-${d}`;
    });
    const resolved = resolvePlanDays(llmDays, TZ, {
      userMessage: 'book breaks first week of next month weekdays',
    }, TODAY);
    expect(resolved).toHaveLength(5);
  });

  test('first week of next month weekdays stays 5 days', () => {
    const resolved = resolvePlanDays([], TZ, {
      userMessage: 'book breaks first week of next month weekdays',
    }, TODAY);
    expect(resolved).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  test('prefers explicit days[] over dayPattern monthOffset when userMessage does not parse', () => {
    const resolved = resolvePlanDays(['2026-05-24'], TZ, {
      dayPattern: { monthOffset: 0, weekdaysOnly: false },
      userMessage: 'three 2-hour meetings on Sunday each with a gap of 1 hour',
    }, TODAY);
    expect(resolved).toEqual(['2026-05-24']);
  });

  test('undefined days[] does not throw', () => {
    expect(() =>
      resolvePlanDays(undefined, TZ, {
        dayPattern: { monthOffset: 0, week: 'last' },
        userMessage: 'last Friday of this month',
      }, TODAY)
    ).not.toThrow();
    const resolved = resolvePlanDays(undefined, TZ, {
      userMessage: 'last Friday of this month',
    }, TODAY);
    expect(resolved).toEqual(['2026-05-29']);
  });
});
