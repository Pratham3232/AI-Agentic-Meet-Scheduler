'use client';

import BookingDayRail, { getProcessedPercent } from './BookingDayRail';
import type { BookingJobItem, CancelJobItem, CancelProgressSnapshot } from '@/types';

function toRailItems(items: CancelJobItem[]): BookingJobItem[] {
  return items.map(i => ({
    day: i.start ? i.start.slice(0, 10) : '—',
    start: i.start,
    end: i.end,
    summary: i.summary,
    status: i.status as BookingJobItem['status'],
    display: i.display,
    error: i.error,
  }));
}

interface CancelProgressProps {
  progress: CancelProgressSnapshot;
}

export default function CancelProgress({ progress }: CancelProgressProps) {
  const railItems = toRailItems(progress.items);
  const remaining = progress.pending;
  const inProgress = progress.status === 'in_progress';
  const displayPercent =
    railItems.length > 0 ? getProcessedPercent(railItems) : progress.percent;
  const problemItems = progress.items.filter(
    i => i.status === 'failed' || i.status === 'skipped'
  );

  return (
    <div className={`booking-progress ${inProgress ? 'booking-progress--active' : ''}`}>
      <div className="booking-progress-header">
        <span className="booking-progress-title">Cancellation progress</span>
        <span className="booking-progress-percent">{displayPercent}%</span>
      </div>

      {railItems.length > 0 ? (
        <BookingDayRail items={railItems} />
      ) : (
        <p className="booking-progress-empty">No events to cancel.</p>
      )}

      <div className="booking-progress-counters">
        <span>Cancelled {progress.cancelled}</span>
        <span>Failed {progress.failed}</span>
        <span>Remaining {remaining}</span>
      </div>

      {problemItems.length > 0 && (
        <details className="booking-progress-failures">
          <summary>
            {problemItems.length} issue{problemItems.length === 1 ? '' : 's'} — show details
          </summary>
          <ul className="booking-progress-list">
            {problemItems.map((item, i) => (
              <li
                key={`${item.eventId}-${i}`}
                className={`booking-item booking-item--${item.status}`}
              >
                <span className="booking-item-label">
                  {item.display ?? item.summary}
                </span>
                {item.error && (
                  <span className="booking-item-error" title={item.error}>
                    {item.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
