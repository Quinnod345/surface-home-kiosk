import { Check, Loader2 } from "lucide-react";

export type StartupTask = { label: string; done: boolean };

// A friendly boot overlay shown while the kiosk warms up (face models, camera,
// recognition service). It tells the user to wait and shows what's still loading,
// so the first open of Settings / face registration doesn't feel broken.
export function StartupIndicator({ tasks }: { tasks: StartupTask[] }) {
  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 100;

  return (
    <div className="startup-indicator" aria-live="polite">
      <div className="startup-card">
        <Loader2 size={26} className="spin" />
        <strong>Warming up…</strong>
        <span className="startup-sub">First boot can take 10–30 seconds.</span>
        <ul className="startup-tasks">
          {tasks.map((task) => (
            <li key={task.label} className={task.done ? "done" : ""}>
              {task.done ? <Check size={15} /> : <Loader2 size={15} className="spin" />}
              <span>{task.label}</span>
            </li>
          ))}
        </ul>
        <div className="startup-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
