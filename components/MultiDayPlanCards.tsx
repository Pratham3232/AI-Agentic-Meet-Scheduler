'use client';

export type PlanDayEntry = {
  day: string;
  status: 'auto_bookable' | 'conflict';
  display?: string;
  requestedDisplay?: string;
  blockers?: Array<{ summary: string; display: string }>;
  suggestedAlternative?: { start: string; end: string; display: string };
};

interface MultiDayPlanCardsProps {
  autoBookable?: PlanDayEntry[];
  conflicts?: PlanDayEntry[];
}

export default function MultiDayPlanCards({ autoBookable, conflicts }: MultiDayPlanCardsProps) {
  const bookable = autoBookable?.filter(e => e.display || e.day) ?? [];
  const conflictList = conflicts?.filter(e => e.day) ?? [];
  if (bookable.length === 0 && conflictList.length === 0) return null;

  return (
    <div className="multi-day-plan">
      {bookable.length > 0 && (
        <div className="plan-section">
          <div className="plan-section-title">Available</div>
          <div className="slot-list">
            {bookable.map((entry, i) => (
              <div key={`ok-${entry.day}-${i}`} className="slot-card event-card plan-ok">
                <span className="slot-number event-number">✓</span>
                <div className="event-info">
                  <span className="event-name">{entry.day}</span>
                  <span className="event-time">{entry.display ?? entry.requestedDisplay}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {conflictList.length > 0 && (
        <div className="plan-section">
          <div className="plan-section-title">Conflicts</div>
          <div className="slot-list">
            {conflictList.map((entry, i) => (
              <div key={`conflict-${entry.day}-${i}`} className="slot-card event-card plan-conflict">
                <span className="slot-number event-number">!</span>
                <div className="event-info">
                  <span className="event-name">{entry.day}</span>
                  <span className="event-time">
                    {entry.requestedDisplay ?? 'Requested time unavailable'}
                  </span>
                  {entry.blockers && entry.blockers.length > 0 && (
                    <span className="plan-blockers">
                      Blocked by: {entry.blockers.map(b => `${b.summary} (${b.display})`).join('; ')}
                    </span>
                  )}
                  {entry.suggestedAlternative && (
                    <span className="plan-alt">
                      Suggested: {entry.suggestedAlternative.display}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
