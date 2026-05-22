import { render, screen } from '@testing-library/react';
import BookingDayRail, {
  getProcessedPercent,
  getRailDensity,
  sortBookingItems,
} from '@/components/BookingDayRail';
import type { BookingJobItem } from '@/types';

function item(
  day: string,
  status: BookingJobItem['status'] = 'pending'
): BookingJobItem {
  return {
    day,
    start: `${day}T09:00:00.000Z`,
    end: `${day}T09:30:00.000Z`,
    summary: 'Yoga',
    status,
  };
}

describe('BookingDayRail utilities', () => {
  test('sortBookingItems orders by ISO day', () => {
    const sorted = sortBookingItems([
      item('2026-06-05'),
      item('2026-06-01'),
      item('2026-06-03'),
    ]);
    expect(sorted.map(i => i.day)).toEqual([
      '2026-06-01',
      '2026-06-03',
      '2026-06-05',
    ]);
  });

  test('getProcessedPercent counts booked, failed, and skipped', () => {
    const items = [
      item('2026-06-01', 'booked'),
      item('2026-06-02', 'failed'),
      item('2026-06-03', 'pending'),
      item('2026-06-04', 'skipped'),
    ];
    expect(getProcessedPercent(items)).toBe(75);
  });

  test('getRailDensity scales with count', () => {
    expect(getRailDensity(5)).toBe('lg');
    expect(getRailDensity(12)).toBe('lg');
    expect(getRailDensity(20)).toBe('md');
    expect(getRailDensity(30)).toBe('sm');
  });
});

describe('BookingDayRail', () => {
  test('renders one dot per item', () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      item(`2026-06-${String(i + 1).padStart(2, '0')}`)
    );
    const { container } = render(<BookingDayRail items={items} />);
    expect(container.querySelectorAll('.booking-rail-dot')).toHaveLength(30);
  });

  test('renders dots in chronological order', () => {
    const items = [item('2026-06-03'), item('2026-06-01'), item('2026-06-02')];
    const { container } = render(<BookingDayRail items={items} />);
    const dots = container.querySelectorAll('.booking-rail-dot');
    expect(dots[0].classList.contains('booking-rail-dot--pending')).toBe(true);
    expect(dots[0].getAttribute('aria-label')).toContain('2026-06-01');
  });

  test('applies failed class on failed dot', () => {
    const items = [
      item('2026-06-01', 'booked'),
      item('2026-06-02', 'failed'),
    ];
    const { container } = render(<BookingDayRail items={items} />);
    expect(container.querySelector('.booking-rail-dot--failed')).toBeTruthy();
  });

  test('fill width matches processed percent', () => {
    const items = [
      item('2026-06-01', 'booked'),
      item('2026-06-02', 'booked'),
      item('2026-06-03', 'pending'),
      item('2026-06-04', 'pending'),
    ];
    render(<BookingDayRail items={items} />);
    const fill = screen.getByTestId('booking-rail-fill');
    expect((fill as HTMLElement).style.width).toBe('50%');
  });

  test('returns null for empty items', () => {
    const { container } = render(<BookingDayRail items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
