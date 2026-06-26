import { Check, Save, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DASHBOARD_SECTIONS,
  accentForPerson,
  getProfilePrefs,
  saveKioskConfig,
  setProfilePrefs,
  type KioskConfig,
  type PersonProfile,
} from "./config";
import type { HaState } from "./homeAssistant";

type UserSettingsViewProps = {
  config: KioskConfig;
  states: HaState[];
  person: PersonProfile;
  // True when the editor (admin) is configuring someone else's profile.
  editingAsAdmin?: boolean;
  onClose: () => void;
  onSaved: (config: KioskConfig) => void;
};

// Accent swatches offered in the picker. Users can also type any hex.
const ACCENT_SWATCHES = [
  "#f0b45c",
  "#5b9cf2",
  "#b47be6",
  "#ff5fa2",
  "#5fd0a8",
  "#f2785b",
  "#7c8cf8",
  "#e0c050",
];

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`calendar-switch ${checked ? "on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function calendarName(state: HaState): string {
  const friendly = state.attributes?.friendly_name;
  if (typeof friendly === "string" && friendly) return friendly;
  return state.entity_id
    .replace(/^calendar\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UserSettingsView({
  config,
  states,
  person,
  editingAsAdmin,
  onClose,
  onSaved,
}: UserSettingsViewProps) {
  const prefs = useMemo(() => getProfilePrefs(config, person.id), [config, person.id]);

  const calendarStates = useMemo(
    () => states.filter((s) => s.entity_id.startsWith("calendar.")),
    [states],
  );
  const allCalendarIds = useMemo(
    () => calendarStates.map((s) => s.entity_id),
    [calendarStates],
  );

  // Theme
  const [accent, setAccent] = useState(
    () => prefs.theme?.accent ?? accentForPerson(config, person),
  );

  // Calendars — empty stored value means "all"; start with all checked in that case.
  const [calendarChecked, setCalendarChecked] = useState<Set<string>>(
    () =>
      new Set(
        prefs.calendarEntityIds && prefs.calendarEntityIds.length
          ? prefs.calendarEntityIds
          : allCalendarIds,
      ),
  );

  // Hidden dashboard sections
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(prefs.hiddenSections ?? []),
  );

  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  function toggleCalendar(entityId: string) {
    setCalendarChecked((current) => {
      const next = new Set(current);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }

  function toggleSection(key: string, visible: boolean) {
    setHidden((current) => {
      const next = new Set(current);
      if (visible) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setStatus("saving");
    setMessage(null);
    try {
      // All checked (or none) => "all calendars" (undefined); otherwise the subset.
      const allChecked =
        allCalendarIds.length > 0 && calendarChecked.size === allCalendarIds.length;
      const calendarEntityIds =
        allChecked || calendarChecked.size === 0
          ? undefined
          : allCalendarIds.filter((id) => calendarChecked.has(id));

      const next = setProfilePrefs(config, person.id, {
        theme: { ...prefs.theme, accent },
        calendarEntityIds,
        hiddenSections: hidden.size ? Array.from(hidden) : [],
      });

      const saved = await saveKioskConfig(next);
      onSaved(saved);
      setStatus("saved");
      setMessage("Saved to this profile.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Could not save.");
    }
  }

  const firstName = person.displayName.split(/\s+/)[0];

  return (
    <div className="settings-view" aria-label={`${person.displayName} settings`}>
      <header className="settings-header">
        <div>
          <span className="settings-eyebrow">
            {editingAsAdmin ? "Profile settings" : "My settings"}
          </span>
          <h1>{firstName}'s dashboard</h1>
        </div>
        <div className="settings-header-actions">
          <button type="button" className="settings-save" onClick={save}>
            {status === "saved" ? <Check size={16} /> : <Save size={16} />}
            <span>{status === "saving" ? "Saving…" : "Save"}</span>
          </button>
          <button type="button" className="settings-close" aria-label="Close settings" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      {message ? (
        <p className={`settings-message ${status === "error" ? "error" : ""}`}>{message}</p>
      ) : null}

      <div className="settings-body">
        {/* THEME */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Theme colour</h2>
            <span className="profile-accent-dot" style={{ background: accent }} />
          </div>
          <p className="settings-help">
            Sets the accent and the background tint across {firstName}'s dashboard.
          </p>
          <div className="profile-swatch-row">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`profile-swatch ${
                  swatch.toLowerCase() === accent.toLowerCase() ? "active" : ""
                }`}
                style={{ background: swatch }}
                aria-label={`Use ${swatch}`}
                onClick={() => setAccent(swatch)}
              />
            ))}
            <label className="profile-swatch-custom" title="Custom colour">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#f0b45c"}
                onChange={(event) => setAccent(event.target.value)}
              />
            </label>
          </div>
        </section>

        {/* CALENDARS */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Calendars</h2>
          </div>
          <p className="settings-help">
            Which calendars {firstName}'s calendar view shows. (The lock screen always
            shows the shared set.)
          </p>
          {calendarStates.length === 0 ? (
            <p className="settings-help">No calendars discovered yet.</p>
          ) : (
            <div className="profile-check-list">
              {calendarStates.map((state) => (
                <label key={state.entity_id} className="profile-check-row">
                  <span>{calendarName(state)}</span>
                  <Switch
                    checked={calendarChecked.has(state.entity_id)}
                    onChange={() => toggleCalendar(state.entity_id)}
                  />
                </label>
              ))}
            </div>
          )}
        </section>

        {/* DASHBOARD SECTIONS */}
        <section className="settings-card">
          <div className="settings-card-head">
            <h2>Dashboard sections</h2>
          </div>
          <p className="settings-help">Hide sections {firstName} doesn't want to see.</p>
          <div className="profile-check-list">
            {DASHBOARD_SECTIONS.map((section) => (
              <label key={section.key} className="profile-check-row">
                <span>{section.label}</span>
                <Switch
                  checked={!hidden.has(section.key)}
                  onChange={(visible) => toggleSection(section.key, visible)}
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
