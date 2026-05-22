import {
  buildInitEntriesFromPlan,
  buildLastMultiDayPlan,
  buildShortPlanSummary,
  resolveInitEntries,
  buildPlanToolResult,
  stateUpdatesForNewPlan,
} from '@/lib/agent/multi-day-plan';
import type { ConversationState } from '@/types';
import type { PlanMultiDayResult } from '@/lib/agent/multi-booking';

function mockPlan(overrides?: Partial<PlanMultiDayResult>): PlanMultiDayResult {
  const days = Array.from({ length: 22 }, (_, i) => {
    const d = String(i + 1).padStart(2, '0');
    return `2026-06-${d}`;
  });
  const autoBookable = days.map(day => ({
    day,
    status: 'auto_bookable' as const,
    start: `${day}T09:00:00.000Z`,
    end: `${day}T09:30:00.000Z`,
    display: `${day} 9:00 AM`,
  }));
  return {
    autoBookable,
    conflicts: [],
    summary: 'All available',
    totalDays: 22,
    days,
    weekdayLabels: days,
    displayList: days.map(d => d),
    ...overrides,
  };
}

describe('multi-day-plan', () => {
  test('resolveInitEntries uses canonical when same length but wrong fingerprint', () => {
    const plan = buildLastMultiDayPlan(
      mockPlan({
        totalDays: 5,
        days: ['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29'],
        autoBookable: ['2026-05-25', '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29'].map(
          day => ({
            day,
            status: 'auto_bookable' as const,
            start: `${day}T23:00:00.000Z`,
            end: `${day}T23:05:00.000Z`,
            display: `${day} 7:00 PM`,
          })
        ),
        weekdayLabels: [],
        displayList: [],
      }),
      '7:00 PM'
    );
    const wrongDays = ['2026-05-26', '2026-05-27', '2026-05-28', '2026-05-29', '2026-05-30'];
    const llm = wrongDays.map(day => ({
      day,
      start: `${day}T23:00:00.000Z`,
      end: `${day}T23:05:00.000Z`,
      summary: 'Meeting',
    }));
    const { entries, overridden } = resolveInitEntries(llm, plan);
    expect(overridden).toBe(true);
    expect(entries.map(e => e.day)).toEqual(plan.days);
  });

  test('resolveInitEntries expands short LLM list to canonical plan', () => {
    const plan = buildLastMultiDayPlan(mockPlan(), '5:00 AM');
    const llm = plan.initEntries.slice(0, 5);
    const { entries, overridden } = resolveInitEntries(llm, plan);
    expect(overridden).toBe(true);
    expect(entries).toHaveLength(22);
  });

  test('resolveInitEntries keeps LLM list when same size or larger', () => {
    const plan = buildLastMultiDayPlan(mockPlan(), '5:00 AM');
    const { entries, overridden } = resolveInitEntries(plan.initEntries, plan);
    expect(overridden).toBe(false);
    expect(entries).toHaveLength(22);
  });

  test('buildShortPlanSummary does not list every day', () => {
    const plan = buildLastMultiDayPlan(mockPlan(), '5:00 AM');
    const summary = buildShortPlanSummary(plan);
    expect(summary).toContain('22 meeting');
    expect(summary).toContain('5:00 AM');
    expect(summary.split(',').length).toBeLessThan(5);
  });

  test('buildPlanToolResult omits displayList for large plans', () => {
    const result = buildPlanToolResult(mockPlan());
    expect(result.displayList).toBeUndefined();
    expect(result.totalDays).toBe(22);
  });

  test('buildLastMultiDayPlan uses custom summary on init entries', () => {
    const plan = buildLastMultiDayPlan(mockPlan(), '5:00 AM', 'Yoga');
    expect(plan.summary).toBe('Yoga');
    expect(plan.initEntries[0].summary).toBe('Yoga');
    expect(buildShortPlanSummary(plan)).toContain('Yoga');
  });

  test('resolveInitEntries prefers longer LLM list after conflict picks', () => {
    const plan = buildLastMultiDayPlan(
      mockPlan({
        autoBookable: [],
        conflicts: [{ day: '2026-06-01', status: 'conflict' }],
        totalDays: 1,
        days: ['2026-06-01'],
      }),
      '5:00 AM',
      'Yoga'
    );
    const llm = [
      {
        day: '2026-06-01',
        start: '2026-06-01T10:00:00.000Z',
        end: '2026-06-01T10:30:00.000Z',
        summary: 'Yoga',
      },
    ];
    const { entries, overridden } = resolveInitEntries(llm, plan);
    expect(overridden).toBe(false);
    expect(entries).toHaveLength(1);
  });

  test('buildPlanToolResult hints for conflict-only plans', () => {
    const result = buildPlanToolResult(
      mockPlan({ autoBookable: [], conflicts: [{ day: '2026-06-01', status: 'conflict' }] })
    );
    expect(String(result.hint)).toContain('conflict');
    expect(result.conflictCount).toBe(1);
  });

  test('stateUpdatesForNewPlan clears stale in-progress job', () => {
    const state = {
      sessionId: 's1',
      cancelJob: null,
      lastBulkCancelTarget: null,
      cancelPlanConfirmed: false,
      confirmedCancelSummary: null,
      bookingJob: {
        id: 'j1',
        status: 'in_progress' as const,
        items: [
          {
            day: '2026-06-01',
            start: '2026-06-01T09:00:00Z',
            end: '2026-06-01T09:30:00Z',
            summary: 'A',
            status: 'pending' as const,
          },
        ],
        updatedAt: new Date().toISOString(),
      },
      lastMultiDayPlan: null,
      bookingPlanConfirmed: true,
      confirmedPlanSummary: 'old',
      cachedCalendar: null,
      calendarVersion: 0,
      pendingReschedule: null,
      lastRescheduledEvent: null,
      slots: {
        duration: null,
        day: null,
        timeWindow: null,
        preferredStart: null,
        preferredEnd: null,
        attendees: [],
      },
      calendarResults: [],
      awaitingConfirmation: false,
      lastSearchParams: null,
      turnCount: 0,
      conversationHistory: [],
    } satisfies ConversationState;
    const updates = stateUpdatesForNewPlan(state);
    expect(updates.bookingJob).toBeNull();
    expect(updates.bookingPlanConfirmed).toBe(false);
  });

  test('buildInitEntriesFromPlan only includes autoBookable with times', () => {
    const plan = mockPlan({
      autoBookable: [
        {
          day: '2026-06-01',
          status: 'auto_bookable',
          start: '2026-06-01T05:00:00.000Z',
          end: '2026-06-01T05:30:00.000Z',
        },
        { day: '2026-06-02', status: 'conflict' },
      ],
      totalDays: 2,
      days: ['2026-06-01', '2026-06-02'],
    });
    const entries = buildInitEntriesFromPlan(plan, 'Yoga');
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('Yoga');
  });
});
