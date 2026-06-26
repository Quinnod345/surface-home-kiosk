import { useMemo, useState } from "react";
import {
  CalendarDays,
  Camera,
  CircleDot,
  CloudSun,
  Gauge,
  ListTodo,
  Radio,
  Search,
} from "lucide-react";
import { friendlyStateName, type HaState } from "./homeAssistant";

const DOMAIN_ICON: Record<string, typeof Camera> = {
  calendar: CalendarDays,
  weather: CloudSun,
  todo: ListTodo,
  camera: Camera,
  sensor: Gauge,
  binary_sensor: Radio,
};

// A card-based entity selector that replaces free-text entity-id boxes. Filters
// the live HA states to one domain. Falls back to a plain text input when no
// states are available yet (e.g. first-run / HA unreachable) so setup isn't blocked.
export function EntityPicker({
  states,
  value,
  onChange,
  domain,
  allowClear,
  placeholder,
}: {
  states: HaState[];
  value: string;
  onChange: (entityId: string) => void;
  domain: string;
  allowClear?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const prefix = `${domain}.`;
    return states
      .filter((s) => s.entity_id.startsWith(prefix))
      .sort((a, b) => friendlyStateName(a).localeCompare(friendlyStateName(b)));
  }, [states, domain]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (s) =>
        s.entity_id.toLowerCase().includes(q) ||
        friendlyStateName(s).toLowerCase().includes(q),
    );
  }, [options, query]);

  // No live states — let the user still type an id (first-run, HA unreachable).
  if (options.length === 0) {
    return (
      <input
        className="entity-picker-fallback"
        value={value}
        placeholder={placeholder ?? `${domain}.example`}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  const Icon = DOMAIN_ICON[domain] ?? CircleDot;

  return (
    <div className="entity-picker">
      {options.length > 6 ? (
        <label className="entity-picker-search">
          <Search size={15} />
          <input
            type="text"
            value={query}
            placeholder="Search…"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}
      <div className="entity-picker-grid">
        {allowClear ? (
          <button
            type="button"
            className={`entity-pick none ${!value ? "active" : ""}`}
            onClick={() => onChange("")}
          >
            <span className="entity-pick-name">None</span>
          </button>
        ) : null}
        {filtered.map((state) => (
          <button
            type="button"
            key={state.entity_id}
            className={`entity-pick ${value === state.entity_id ? "active" : ""}`}
            onClick={() => onChange(state.entity_id)}
          >
            <Icon size={18} />
            <span className="entity-pick-name">{friendlyStateName(state)}</span>
            <span className="entity-pick-id">{state.entity_id}</span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <span className="entity-pick-empty">No matches</span>
        ) : null}
      </div>
    </div>
  );
}
