import { useMemo, useState } from "react";
import {
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useTravelTime } from "./travelApi";
import type { KioskConfig } from "./config";
import type { HaState } from "./homeAssistant";
import {
  CALENDAR_PALETTE,
  type CalendarEvent,
  type CalendarSource,
  monthGridRange,
  useCalendarEvents,
  useCalendarSources,
} from "./useCalendar";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  draftFromDate,
  draftFromEvent,
  type EventDraft,
  updateCalendarEvent,
} from "./calendarApi";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthFormatter = new Intl.DateTimeFormat([], { month: "long", year: "numeric" });
const fullDayFormatter = new Intl.DateTimeFormat([], {
  weekday: "long",
  month: "long",
  day: "numeric",
});

const SWATCHES = [
  ...CALENDAR_PALETTE,
  "#f25c54",
  "#9bd16b",
  "#4db6ac",
  "#5c7cfa",
  "#b197fc",
  "#ff922b",
];

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}
function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}
function dateOnly(value: string | Date): Date {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Days (as YYYY-MM-DD keys) a given event occupies, clamped to the visible grid.
function eventDayKeys(event: CalendarEvent, gridStart: Date, gridDays: number): string[] {
  if (!event.start) return [];
  const start = dateOnly(event.start);
  let last = start;
  if (event.end) {
    const end = dateOnly(event.end);
    last = event.allDay ? addDays(end, -1) : end;
  }
  if (last < start) last = start;
  const gridEnd = addDays(gridStart, gridDays - 1);
  const from = start < gridStart ? gridStart : start;
  const to = last > gridEnd ? gridEnd : last;
  const keys: string[] = [];
  for (let d = new Date(from); d <= to; d = addDays(d, 1)) keys.push(dayKey(d));
  return keys;
}

type EditorState = {
  mode: "create" | "edit";
  original: CalendarEvent | null;
  summary: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  description: string;
};

function editorFromDraft(
  draft: EventDraft,
  mode: "create" | "edit",
  original: CalendarEvent | null,
): EditorState {
  const splitTimed = (value: string) => {
    const [date, time] = value.split("T");
    return { date, time: (time ?? "09:00:00").slice(0, 5) };
  };
  if (draft.allDay) {
    return {
      mode,
      original,
      summary: draft.summary,
      calendarId: draft.calendarId,
      allDay: true,
      startDate: draft.start,
      startTime: "09:00",
      endDate: draft.end,
      endTime: "10:00",
      location: draft.location,
      description: draft.description,
    };
  }
  const s = splitTimed(draft.start);
  const e = splitTimed(draft.end);
  return {
    mode,
    original,
    summary: draft.summary,
    calendarId: draft.calendarId,
    allDay: false,
    startDate: s.date,
    startTime: s.time,
    endDate: e.date,
    endTime: e.time,
    location: draft.location,
    description: draft.description,
  };
}

function editorToDraft(editor: EditorState): EventDraft {
  if (editor.allDay) {
    // All-day end is exclusive; ensure at least one day.
    const start = editor.startDate;
    let end = editor.endDate;
    if (!end || end < start) {
      end = dayKey(addDays(new Date(`${start}T00:00:00`), 1));
    } else if (end === start) {
      end = dayKey(addDays(new Date(`${start}T00:00:00`), 1));
    }
    return {
      calendarId: editor.calendarId,
      summary: editor.summary,
      description: editor.description,
      location: editor.location,
      allDay: true,
      start,
      end,
    };
  }
  return {
    calendarId: editor.calendarId,
    summary: editor.summary,
    description: editor.description,
    location: editor.location,
    allDay: false,
    start: `${editor.startDate}T${editor.startTime}:00`,
    end: `${editor.endDate}T${editor.endTime}:00`,
  };
}

function DayEvent({
  event,
  source,
  index,
  editable,
  travelEnabled,
  onEdit,
}: {
  event: CalendarEvent;
  source: CalendarSource | undefined;
  index: number;
  editable: boolean;
  travelEnabled: boolean;
  onEdit: () => void;
}) {
  const hasLocation = !!event.location && travelEnabled;
  const travel = useTravelTime(hasLocation ? event.location : null, hasLocation);
  return (
    <button
      type="button"
      className="calendar-day-event"
      style={{ ["--cal-color" as string]: event.color, ["--i" as string]: index }}
      onClick={() => (editable ? onEdit() : undefined)}
    >
      <span className="calendar-day-rail" />
      <span className="calendar-day-time">
        {event.allDay || !event.start
          ? "All day"
          : new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </span>
      <span className="calendar-day-body">
        <strong>{event.summary}</strong>
        <span className="calendar-day-source">{source?.name ?? ""}</span>
        {event.location ? (
          <span className="calendar-day-loc">
            <MapPin size={12} /> {event.location}
          </span>
        ) : null}
        {travel && travel.ok ? (
          <span className="calendar-day-travel">
            <Car size={12} /> {travel.durationMin} min · {travel.distanceMiles} mi
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function CalendarView({
  config,
  states,
  calendarEntityIds,
  onSaveConfig,
}: {
  config: KioskConfig;
  states: HaState[];
  // When set (non-empty), restrict this view to the active person's calendars.
  // Empty/undefined shows every discovered calendar.
  calendarEntityIds?: string[];
  onSaveConfig: (next: KioskConfig) => void;
}) {
  const allSources = useCalendarSources(config, states);
  const sources = useMemo(
    () =>
      calendarEntityIds && calendarEntityIds.length
        ? allSources.filter((s) => calendarEntityIds.includes(s.entityId))
        : allSources,
    [allSources, calendarEntityIds],
  );
  const writableSources = sources.filter((s) => s.canCreate);

  const today = useMemo(() => new Date(), []);
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [showCalendars, setShowCalendars] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const GRID_DAYS = 42;
  const { gridStart, startISO: rangeStartISO, endISO: rangeEndISO } = useMemo(
    () => monthGridRange(monthAnchor),
    [monthAnchor],
  );
  const gridDays = useMemo(
    () => Array.from({ length: GRID_DAYS }, (_, i) => addDays(gridStart, i)),
    [gridStart],
  );
  const { events } = useCalendarEvents(sources, rangeStartISO, rangeEndISO, true, refreshToken);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      for (const key of eventDayKeys(event, gridStart, GRID_DAYS)) {
        const list = map.get(key);
        if (list) list.push(event);
        else map.set(key, [event]);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
        const at = a.startDate ? a.startDate.getTime() : 0;
        const bt = b.startDate ? b.startDate.getTime() : 0;
        return at - bt;
      });
    }
    return map;
  }, [events, gridStart]);

  const selectedEvents = selectedDay ? eventsByDay.get(dayKey(selectedDay)) ?? [] : [];

  function openCreate(day: Date) {
    setError(null);
    // Prefer the configured primary calendar, else the first writable one.
    const preferred = config.calendar?.entityId;
    const calendarId =
      (preferred && writableSources.some((s) => s.entityId === preferred) ? preferred : null) ??
      writableSources[0]?.entityId ??
      sources[0]?.entityId ??
      "";
    if (!calendarId) {
      setError("No writable calendar available.");
      return;
    }
    setEditor(editorFromDraft(draftFromDate(calendarId, day), "create", null));
  }

  function openEdit(event: CalendarEvent) {
    setError(null);
    setEditor(editorFromDraft(draftFromEvent(event), "edit", event));
  }

  async function saveEditor() {
    if (!editor) return;
    setBusy(true);
    setError(null);
    try {
      const draft = editorToDraft(editor);
      if (editor.mode === "edit" && editor.original) {
        await updateCalendarEvent(config, editor.original, draft);
      } else {
        await createCalendarEvent(config, draft);
      }
      setEditor(null);
      // HA writes are eventually consistent; refetch shortly after.
      setRefreshToken((t) => t + 1);
      window.setTimeout(() => setRefreshToken((t) => t + 1), 1200);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save event.");
    } finally {
      setBusy(false);
    }
  }

  async function removeEvent(event: CalendarEvent) {
    setBusy(true);
    setError(null);
    try {
      await deleteCalendarEvent(event);
      setEditor(null);
      setRefreshToken((t) => t + 1);
      window.setTimeout(() => setRefreshToken((t) => t + 1), 1200);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete event.");
    } finally {
      setBusy(false);
    }
  }

  function setCalendarColor(entityId: string, color: string) {
    const colors = { ...(config.calendar?.colors ?? {}), [entityId]: color };
    onSaveConfig({ ...config, calendar: { ...config.calendar, colors } });
  }

  function toggleCalendar(source: CalendarSource) {
    const hidden = new Set(config.calendar?.hidden ?? []);
    if (source.enabled) hidden.add(source.entityId);
    else hidden.delete(source.entityId);
    onSaveConfig({
      ...config,
      calendar: { ...config.calendar, hidden: Array.from(hidden) },
    });
  }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-month-nav">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonthAnchor((m) => addMonths(m, -1))}
          >
            <ChevronLeft size={20} />
          </button>
          <h2>{monthFormatter.format(monthAnchor)}</h2>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonthAnchor((m) => addMonths(m, 1))}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div className="calendar-toolbar-actions">
          <button
            type="button"
            className="calendar-today"
            onClick={() => {
              setMonthAnchor(startOfMonth(new Date()));
              setSelectedDay(new Date());
            }}
          >
            Today
          </button>
          <button
            type="button"
            className={`calendar-filter-btn ${showCalendars ? "active" : ""}`}
            aria-label="Calendars"
            onClick={() => setShowCalendars((v) => !v)}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>
      </div>

      <div className="calendar-weekdays">
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="calendar-grid">
        {gridDays.map((day, index) => {
          const inMonth = day.getMonth() === monthAnchor.getMonth();
          const isToday = isSameDay(day, today);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const dayEvents = eventsByDay.get(dayKey(day)) ?? [];
          return (
            <button
              type="button"
              key={dayKey(day)}
              className={`calendar-cell ${inMonth ? "" : "muted"} ${isToday ? "today" : ""} ${
                isSelected ? "selected" : ""
              }`}
              style={{ ["--i" as string]: index }}
              onClick={() => setSelectedDay(day)}
            >
              <span className="calendar-cell-date">{day.getDate()}</span>
              <span className="calendar-cell-events">
                {dayEvents.slice(0, 3).map((event, index) => (
                  <span
                    className="calendar-chip"
                    key={`${event.calendarId}-${event.uid ?? index}`}
                    style={{ ["--cal-color" as string]: event.color }}
                  >
                    <span className="calendar-chip-dot" />
                    <span className="calendar-chip-text">{event.summary}</span>
                  </span>
                ))}
                {dayEvents.length > 3 ? (
                  <span className="calendar-more">+{dayEvents.length - 3} more</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {selectedDay ? (
        <div className="calendar-day-backdrop" onPointerDown={() => setSelectedDay(null)}>
          <aside className="calendar-day-panel" onPointerDown={(e) => e.stopPropagation()}>
            <header>
              <div>
                <span className="calendar-day-eyebrow">Agenda</span>
                <h3>{fullDayFormatter.format(selectedDay)}</h3>
              </div>
              <div className="calendar-day-actions">
                <button
                  type="button"
                  className="calendar-add"
                  disabled={writableSources.length === 0}
                  onClick={() => openCreate(selectedDay)}
                >
                  <Plus size={16} />
                  <span>Add</span>
                </button>
                <button
                  type="button"
                  aria-label="Close"
                  className="calendar-icon-btn"
                  onClick={() => setSelectedDay(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </header>
            {selectedEvents.length ? (
              <div className="calendar-day-events">
                {selectedEvents.map((event, index) => {
                  const source = sources.find((s) => s.entityId === event.calendarId);
                  const editable = !!event.uid && !!source?.canDelete && !!source?.canCreate;
                  return (
                    <DayEvent
                      key={`${event.calendarId}-${event.uid ?? index}`}
                      event={event}
                      source={source}
                      index={index}
                      editable={editable}
                      travelEnabled={config.travel?.provider === "mapbox"}
                      onEdit={() => openEdit(event)}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="calendar-day-empty">
                <span>Nothing scheduled</span>
                {writableSources.length ? (
                  <button type="button" onClick={() => openCreate(selectedDay)}>
                    <Plus size={16} /> Add an event
                  </button>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      ) : null}

      {editor ? (
        <div className="calendar-day-backdrop" onPointerDown={() => !busy && setEditor(null)}>
          <div className="calendar-editor" onPointerDown={(e) => e.stopPropagation()}>
            <header>
              <h3>{editor.mode === "edit" ? "Edit event" : "New event"}</h3>
              <button
                type="button"
                aria-label="Close"
                className="calendar-icon-btn"
                onClick={() => setEditor(null)}
              >
                <X size={18} />
              </button>
            </header>

            <label className="calendar-field">
              <span>Title</span>
              <input
                type="text"
                value={editor.summary}
                placeholder="Add a title"
                onChange={(e) => setEditor({ ...editor, summary: e.target.value })}
              />
            </label>

            <label className="calendar-field">
              <span>Calendar</span>
              <div className="calendar-select-row">
                {writableSources.map((source) => (
                  <button
                    type="button"
                    key={source.entityId}
                    className={`calendar-pill ${
                      editor.calendarId === source.entityId ? "active" : ""
                    }`}
                    style={{ ["--cal-color" as string]: source.color }}
                    onClick={() => setEditor({ ...editor, calendarId: source.entityId })}
                  >
                    <span className="calendar-pill-dot" />
                    {source.name}
                  </button>
                ))}
              </div>
            </label>

            <label className="calendar-toggle-field">
              <span>All day</span>
              <button
                type="button"
                className={`calendar-switch ${editor.allDay ? "on" : ""}`}
                role="switch"
                aria-checked={editor.allDay}
                onClick={() => setEditor({ ...editor, allDay: !editor.allDay })}
              >
                <span />
              </button>
            </label>

            <div className="calendar-field-row">
              <label className="calendar-field">
                <span>Starts</span>
                <input
                  type="date"
                  value={editor.startDate}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      startDate: e.target.value,
                      endDate: editor.endDate < e.target.value ? e.target.value : editor.endDate,
                    })
                  }
                />
              </label>
              {!editor.allDay ? (
                <label className="calendar-field calendar-field-time">
                  <span>&nbsp;</span>
                  <input
                    type="time"
                    value={editor.startTime}
                    onChange={(e) => setEditor({ ...editor, startTime: e.target.value })}
                  />
                </label>
              ) : null}
            </div>

            <div className="calendar-field-row">
              <label className="calendar-field">
                <span>Ends</span>
                <input
                  type="date"
                  value={editor.endDate}
                  min={editor.startDate}
                  onChange={(e) => setEditor({ ...editor, endDate: e.target.value })}
                />
              </label>
              {!editor.allDay ? (
                <label className="calendar-field calendar-field-time">
                  <span>&nbsp;</span>
                  <input
                    type="time"
                    value={editor.endTime}
                    onChange={(e) => setEditor({ ...editor, endTime: e.target.value })}
                  />
                </label>
              ) : null}
            </div>

            <label className="calendar-field">
              <span>Location</span>
              <input
                type="text"
                value={editor.location}
                placeholder="Optional"
                onChange={(e) => setEditor({ ...editor, location: e.target.value })}
              />
            </label>

            <label className="calendar-field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={editor.description}
                placeholder="Optional"
                onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              />
            </label>

            {error ? <p className="calendar-error">{error}</p> : null}

            <div className="calendar-editor-actions">
              {editor.mode === "edit" && editor.original ? (
                <button
                  type="button"
                  className="calendar-delete"
                  disabled={busy}
                  onClick={() => editor.original && removeEvent(editor.original)}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              ) : (
                <span />
              )}
              <div>
                <button
                  type="button"
                  className="calendar-cancel"
                  disabled={busy}
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </button>
                <button type="button" className="calendar-save" disabled={busy} onClick={saveEditor}>
                  <Check size={16} />
                  <span>{busy ? "Saving…" : "Save"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showCalendars ? (
        <div className="calendar-day-backdrop" onPointerDown={() => setShowCalendars(false)}>
          <aside className="calendar-sources" onPointerDown={(e) => e.stopPropagation()}>
            <header>
              <h3>Calendars</h3>
              <button
                type="button"
                aria-label="Close"
                className="calendar-icon-btn"
                onClick={() => setShowCalendars(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="calendar-source-list">
              {sources.map((source) => (
                <div className="calendar-source" key={source.entityId}>
                  <div className="calendar-source-head">
                    <button
                      type="button"
                      className={`calendar-source-toggle ${source.enabled ? "on" : ""}`}
                      style={{ ["--cal-color" as string]: source.color }}
                      onClick={() => toggleCalendar(source)}
                    >
                      <span className="calendar-source-check">
                        {source.enabled ? <Check size={13} /> : null}
                      </span>
                    </button>
                    <div className="calendar-source-meta">
                      <strong>{source.name}</strong>
                      <span>{source.canCreate ? "Editable" : "Read-only"}</span>
                    </div>
                  </div>
                  <div className="calendar-color-row">
                    {SWATCHES.map((color) => (
                      <button
                        type="button"
                        key={color}
                        className={`calendar-swatch ${
                          source.color.toLowerCase() === color.toLowerCase() ? "active" : ""
                        }`}
                        style={{ background: color }}
                        aria-label={`Set ${source.name} colour`}
                        onClick={() => setCalendarColor(source.entityId, color)}
                      />
                    ))}
                    <label
                      className="calendar-swatch-custom"
                      style={{ background: source.color }}
                      aria-label={`Custom colour for ${source.name}`}
                    >
                      <input
                        type="color"
                        value={source.color}
                        onChange={(e) => setCalendarColor(source.entityId, e.target.value)}
                      />
                    </label>
                  </div>
                </div>
              ))}
              {sources.length === 0 ? (
                <p className="calendar-empty">No calendars found in Home Assistant.</p>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
