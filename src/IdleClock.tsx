import { useEffect, useState } from "react";

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

// Self-contained clock so the per-second tick re-renders only this component,
// not the whole app (which would otherwise recompute the dashboard each second).
export function IdleClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="idle-clock">
      <span>{timeFormatter.format(now)}</span>
      <small>{dateFormatter.format(now)}</small>
    </div>
  );
}
