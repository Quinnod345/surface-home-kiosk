import { useEffect, useMemo, useState } from "react";
import type { KioskConfig } from "./config";
import type { HaState } from "./homeAssistant";

// Home Assistant calendar supported_features bitmask.
const FEATURE_CREATE = 1;
const FEATURE_DELETE = 2;
const FEATURE_UPDATE = 4;

// A warm, distinct palette assigned to calendars that have no custom colour yet.
export const CALENDAR_PALETTE = [
  "#f7b955", // amber
  "#6cc4a1", // sage
  "#7aa7ff", // sky
  "#e8896b", // coral
  "#c79bf0", // lilac
  "#e6c34d", // gold
  "#79d0d8", // teal
  "#f08bb4", // rose
];

export type CalendarSource = {
  entityId: string;
  name: string;
  color: string;
  enabled: boolean;
  canCreate: boolean;
  canDelete: boolean;
  canUpdate: boolean;
};

export type CalendarEvent = {
  calendarId: string;
  color: string;
  summary: string;
  description: string;
  location: string;
  // ISO strings; `start`/`end` may be date-only for all-day events.
  start: string | null;
  end: string | null;
  allDay: boolean;
  uid: string | null;
  recurrenceId: string | null;
  // Resolved Date for the event's start, for sorting/placement.
  startDate: Date | null;
};

function stableColorIndex(entityId: string): number {
  let hash = 0;
  for (let i = 0; i < entityId.length; i++) {
    hash = (hash * 31 + entityId.charCodeAt(i)) >>> 0;
  }
  return hash % CALENDAR_PALETTE.length;
}

function friendlyCalendarName(state: HaState): string {
  const friendly = state.attributes?.friendly_name;
  if (typeof friendly === "string" && friendly.trim()) return friendly.trim();
  return state.entity_id
    .replace(/^calendar\./, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Derive the list of calendars from the polled HA states plus the user's saved
// colour/visibility overrides. Falls back to the single configured calendar
// entity when no calendar entities are present in the state set yet.
export function deriveCalendarSources(states: HaState[], config: KioskConfig): CalendarSource[] {
  const colors = config.calendar?.colors ?? {};
  const hidden = new Set(config.calendar?.hidden ?? []);

  const calendarStates = states.filter((s) => s.entity_id.startsWith("calendar."));

  const sources: CalendarSource[] = calendarStates.map((state) => {
    const features =
      typeof state.attributes?.supported_features === "number"
        ? (state.attributes.supported_features as number)
        : 0;
    const entityId = state.entity_id;
    return {
      entityId,
      name: friendlyCalendarName(state),
      color: colors[entityId] ?? CALENDAR_PALETTE[stableColorIndex(entityId)],
      enabled: !hidden.has(entityId),
      canCreate: (features & FEATURE_CREATE) !== 0,
      canDelete: (features & FEATURE_DELETE) !== 0,
      canUpdate: (features & FEATURE_UPDATE) !== 0,
    };
  });

  if (sources.length === 0 && config.calendar?.entityId) {
    const entityId = config.calendar.entityId;
    sources.push({
      entityId,
      name: friendlyCalendarName({ entity_id: entityId, state: "", attributes: {} }),
      color: colors[entityId] ?? CALENDAR_PALETTE[stableColorIndex(entityId)],
      enabled: !hidden.has(entityId),
      canCreate: true,
      canDelete: true,
      canUpdate: false,
    });
  }

  sources.sort((a, b) => a.name.localeCompare(b.name));
  return sources;
}

export function useCalendarSources(config: KioskConfig, states: HaState[]): CalendarSource[] {
  return useMemo(() => deriveCalendarSources(states, config), [states, config]);
}

// The 6-week (42-day) window a month grid covers, starting on the Sunday on/before
// the 1st. Shared by the dashboard prefetch and the calendar view so their event
// cache keys line up exactly (calendar opens with no fetch flash).
export function monthGridRange(anchor: Date): {
  gridStart: Date;
  startISO: string;
  endISO: string;
} {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - firstOfMonth.getDay());
  const end = new Date(gridStart);
  end.setDate(end.getDate() + 42);
  return { gridStart, startISO: gridStart.toISOString(), endISO: end.toISOString() };
}

function parseEvent(raw: unknown, source: CalendarSource): CalendarEvent {
  const event = (raw ?? {}) as {
    summary?: unknown;
    description?: unknown;
    location?: unknown;
    uid?: unknown;
    recurrence_id?: unknown;
    start?: { dateTime?: unknown; date?: unknown };
    end?: { dateTime?: unknown; date?: unknown };
  };
  const summary =
    typeof event.summary === "string" && event.summary ? event.summary : "Busy";
  const description = typeof event.description === "string" ? event.description : "";
  const location = typeof event.location === "string" ? event.location : "";
  const uid = typeof event.uid === "string" ? event.uid : null;
  const recurrenceId = typeof event.recurrence_id === "string" ? event.recurrence_id : null;

  const startDateTime = typeof event.start?.dateTime === "string" ? event.start.dateTime : null;
  const startDateOnly = typeof event.start?.date === "string" ? event.start.date : null;
  const endDateTime = typeof event.end?.dateTime === "string" ? event.end.dateTime : null;
  const endDateOnly = typeof event.end?.date === "string" ? event.end.date : null;

  const allDay = !startDateTime;
  const start = startDateTime ?? startDateOnly ?? null;
  const end = endDateTime ?? endDateOnly ?? null;

  return {
    calendarId: source.entityId,
    color: source.color,
    summary,
    description,
    location,
    start,
    end,
    allDay,
    uid,
    recurrenceId,
    startDate: start ? new Date(start) : null,
  };
}

// Cache of the last fetched events per (calendars + window). Lets a prefetch on
// the dashboard make the calendar/agenda render instantly (no fetch flash) and
// survives unmount/remount of the calendar view.
const eventCache = new Map<string, CalendarEvent[]>();
function eventCacheKey(activeKey: string, start: string, end: string): string {
  return `${activeKey}|${start}|${end}`;
}

// Fetch events across all enabled calendars for the given window. `refreshToken`
// can be bumped to force a re-fetch (e.g. after creating/deleting an event).
export function useCalendarEvents(
  sources: CalendarSource[],
  rangeStartISO: string,
  rangeEndISO: string,
  enabled: boolean,
  refreshToken = 0,
): { events: CalendarEvent[]; loading: boolean } {
  const activeKey = sources
    .filter((s) => s.enabled)
    .map((s) => `${s.entityId}:${s.color}`)
    .join(",");
  const cacheKey = eventCacheKey(activeKey, rangeStartISO, rangeEndISO);

  // Seed synchronously from cache so a warmed range paints immediately.
  const [events, setEvents] = useState<CalendarEvent[]>(() => eventCache.get(cacheKey) ?? []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const active = sources.filter((s) => s.enabled);
    if (!enabled || active.length === 0 || !window.surfaceKiosk?.getCalendar) {
      setEvents([]);
      return;
    }

    // Show cached events for this exact range immediately while refetching.
    const cached = eventCache.get(cacheKey);
    if (cached) setEvents(cached);

    let cancelled = false;
    setLoading(true);
    async function load() {
      const all: CalendarEvent[] = [];
      await Promise.all(
        active.map(async (source) => {
          try {
            const raw = await window.surfaceKiosk!.getCalendar(
              source.entityId,
              rangeStartISO,
              rangeEndISO,
            );
            if (Array.isArray(raw)) {
              for (const item of raw) all.push(parseEvent(item, source));
            }
          } catch {
            // Skip a calendar that fails; others still render.
          }
        }),
      );
      if (cancelled) return;
      all.sort((a, b) => {
        const at = a.startDate ? a.startDate.getTime() : 0;
        const bt = b.startDate ? b.startDate.getTime() : 0;
        return at - bt;
      });
      eventCache.set(cacheKey, all);
      setEvents(all);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, rangeStartISO, rangeEndISO, enabled, refreshToken]);

  return { events, loading };
}

// Today's events across enabled calendars, refreshed periodically — used by the
// lock-screen overlay.
export function useTodayAgenda(
  config: KioskConfig,
  states: HaState[],
  enabled: boolean,
): CalendarEvent[] {
  const sources = useCalendarSources(config, states);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 15 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  const { start, end } = useMemo(() => {
    const now = new Date();
    const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { start: s.toISOString(), end: e.toISOString() };
    // Recompute the day window on each refresh tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const calendarEnabled = enabled && (config.calendar?.enabled ?? false);
  const { events } = useCalendarEvents(sources, start, end, calendarEnabled, tick);
  return events;
}
