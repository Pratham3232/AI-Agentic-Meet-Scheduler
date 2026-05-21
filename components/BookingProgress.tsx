'use client';

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

  return (
    <div className={`booking-progress ${inProgress ? 'booking-progress--active' : ''}`}>
      <div className="booking-progress-header">
        <span className="booking-progress-title">Booking progress</span>
        <span className="booking-progress-percent">{progress.percent}%</span>
      </div>
      <div className="booking-progress-bar-wrap">
        <div
          className="booking-progress-bar"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="booking-progress-counters">
        <span>Booked {progress.booked}</span>
        <span>Failed {progress.failed}</span>
        <span>Remaining {remaining}</span>
      </div>
      <ul className="booking-progress-list">
        {progress.items.map((item, i) => (
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
    </div>
  );
}
