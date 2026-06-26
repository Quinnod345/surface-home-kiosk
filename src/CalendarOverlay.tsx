import { useState } from "react";
import { CalendarDays } from "lucide-react";
import type { CalendarEvent } from "./useCalendar";

const timeFormatter = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function eventTime(event: CalendarEvent): string {
  if (event.allDay || !event.start) return "All day";
  return timeFormatter.format(new Date(event.start));
}

// Today's agenda, overlaid on the photo screen. Interactive: touching it does not
// dismiss the photo screen (App stops the event from reaching the global tap
// handler) — only taps outside this panel open the dashboard. Tapping an event
// expands its details in place.
export function CalendarOverlay({
  events,
  onInteract,
}: {
  events: CalendarEvent[];
  onInteract: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const now = Date.now();
  const upcoming = events.filter(
    (event) =>
      event.allDay || !event.start || new Date(event.start).getTime() >= now - 3_600_000,
  );

  return (
    <div
      className="calendar-overlay"
      onPointerDown={(event) => {
        // Keep the photo screen up and the display awake while the user reads or
        // scrolls the agenda; don't bubble to the global "open dashboard" tap.
        event.stopPropagation();
        onInteract();
      }}
    >
      <div className="calendar-head">
        <CalendarDays size={16} />
        <span>{dayFormatter.format(new Date())}</span>
      </div>
      {upcoming.length ? (
        <div className="calendar-list">
          {upcoming.map((event, index) => {
            const key = `${event.calendarId}-${event.uid ?? event.start ?? index}`;
            const isOpen = expanded === key;
            return (
              <button
                type="button"
                className={`calendar-event ${isOpen ? "open" : ""}`}
                key={key}
                style={{ ["--cal-color" as string]: event.color }}
                onClick={() => setExpanded(isOpen ? null : key)}
              >
                <span className="calendar-rail" />
                <span className="calendar-time">{eventTime(event)}</span>
                <span className="calendar-body">
                  <span className="calendar-title">{event.summary}</span>
                  {isOpen && (event.location || event.description) ? (
                    <span className="calendar-detail">
                      {event.location ? <em>{event.location}</em> : null}
                      {event.description ? <span>{event.description}</span> : null}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="calendar-empty">Nothing scheduled today</div>
      )}
    </div>
  );
}
