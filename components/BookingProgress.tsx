'use client';

import BookingDayRail, { getProcessedPercent } from './BookingDayRail';
import type { BookingJobItem, BookingProgressSnapshot } from '@/types';

interface BookingProgressProps {
  progress: BookingProgressSnapshot;
}

function statusIcon(status: BookingJobItem['status']): string {
  switch (status) {
    case 'booked':
      return '✓';
    case 'failed':
      return '✕';
    case 'skipped':
      return '–';
    default:
      return '…';
  }
}

export default function BookingProgress({ progress }: BookingProgressProps) {
  const remaining = progress.pending;
  const inProgress = progress.status === 'in_progress';
  const displayPercent =
    progress.items.length > 0
      ? getProcessedPercent(progress.items)
      : progress.percent;
  const problemItems = progress.items.filter(
    i => i.status === 'failed' || i.status === 'skipped'
  );

  return (
    <div className={`booking-progress ${inProgress ? 'booking-progress--active' : ''}`}>
      <div className="booking-progress-header">
        <span className="booking-progress-title">Booking progress</span>
        <span className="booking-progress-percent">{displayPercent}%</span>
      </div>

      {progress.items.length > 0 ? (
        <BookingDayRail items={progress.items} />
      ) : (
        <p className="booking-progress-empty">No bookings scheduled.</p>
      )}

      <div className="booking-progress-counters">
        <span>Booked {progress.booked}</span>
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
                key={`${item.day}-${item.start}-${i}`}
                className={`booking-item booking-item--${item.status}`}
              >
                <span className="booking-item-icon">{statusIcon(item.status)}</span>
                <span className="booking-item-label">
                  {item.display ?? `${item.day} · ${item.summary}`}
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
