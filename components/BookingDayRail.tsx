'use client';

import type { CSSProperties } from 'react';
import type { BookingJobItem } from '@/types';

export type RailDensity = 'sm' | 'md' | 'lg';

export function sortBookingItems(items: BookingJobItem[]): BookingJobItem[] {
  return [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

export function getProcessedPercent(items: BookingJobItem[]): number {
  if (items.length === 0) return 100;
  const processed = items.filter(i => i.status !== 'pending').length;
  return Math.round((processed / items.length) * 100);
}

export function getRailDensity(count: number): RailDensity {
  if (count <= 12) return 'lg';
  if (count <= 24) return 'md';
  return 'sm';
}

function dotLabel(item: BookingJobItem): string {
  return `${item.display ?? `${item.day || item.start} · ${item.summary}`} — ${item.status}`;
}

function sortKey(item: BookingJobItem): string {
  return item.day || item.start || '';
}

interface BookingDayRailProps {
  items: BookingJobItem[];
}

export default function BookingDayRail({ items }: BookingDayRailProps) {
  const sorted = sortBookingItems(items);
  const total = sorted.length;
  if (total === 0) return null;

  const processedPercent = getProcessedPercent(sorted);
  const density = getRailDensity(total);
  const processed = sorted.filter(i => i.status !== 'pending').length;

  return (
    <div
      className={`booking-rail booking-rail--${density}`}
      data-count={total}
      data-scroll={total > 20 ? 'true' : undefined}
      style={{ '--rail-count': total } as CSSProperties}
      role="progressbar"
      aria-valuenow={processed}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={`Booking progress: ${processed} of ${total} days processed`}
    >
      <div className="booking-rail-track">
        <div
          className="booking-rail-fill"
          style={{ width: `${processedPercent}%` }}
          data-testid="booking-rail-fill"
        />
      </div>
      <div className="booking-rail-dots">
        {sorted.map((item, i) => (
          <span
            key={`${item.day}-${item.start}-${i}`}
            className={`booking-rail-dot booking-rail-dot--${item.status}`}
            title={dotLabel(item)}
            aria-label={dotLabel(item)}
          />
        ))}
      </div>
    </div>
  );
}
