import { useEffect, useState } from "react";
import type { CalendarEvent } from "./useCalendar";

export type TravelResult =
  | { ok: true; durationMin: number; distanceMiles: number; destName: string }
  | { ok: false; reason: string };

// Renderer-side cache so several components asking for the same location don't
// each pay an IPC round-trip. (The main process also caches the network calls.)
const cache = new Map<string, { at: number; value: TravelResult }>();
const TTL = 5 * 60_000;

export function useTravelTime(location: string | null, enabled: boolean): TravelResult | null {
  const [result, setResult] = useState<TravelResult | null>(() => {
    if (!enabled || !location) return null;
    const hit = cache.get(location.trim().toLowerCase());
    return hit && Date.now() - hit.at < TTL ? hit.value : null;
  });

  useEffect(() => {
    if (!enabled || !location || !location.trim() || !window.surfaceKiosk?.estimateTravel) {
      setResult(null);
      return;
    }
    const key = location.trim().toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) {
      setResult(hit.value);
      return;
    }
    let cancelled = false;
    void window.surfaceKiosk
      .estimateTravel(location)
      .then((value) => {
        if (cancelled) return;
        cache.set(key, { at: Date.now(), value: value as TravelResult });
        setResult(value as TravelResult);
      })
      .catch(() => {
        if (!cancelled) setResult(null);
      });
    return () => {
      cancelled = true;
    };
  }, [location, enabled]);

  return result;
}

export type LeaveStatus = { label: string; urgent: boolean } | null;

// Given a timed event and its drive time, how soon must you leave? Returns a
// nudge only once we're within `bufferMin` of departure and before the event.
export function leaveStatus(
  event: CalendarEvent,
  durationMin: number,
  bufferMin: number,
  nowMs: number,
): LeaveStatus {
  if (event.allDay || !event.start) return null;
  const startMs = new Date(event.start).getTime();
  if (nowMs >= startMs) return null; // already started
  const leaveMs = startMs - durationMin * 60_000;
  const minsUntilLeave = Math.round((leaveMs - nowMs) / 60_000);
  if (minsUntilLeave > bufferMin) return null;
  if (minsUntilLeave <= 0) return { label: "Leave now", urgent: true };
  return { label: `Leave in ${minsUntilLeave} min`, urgent: minsUntilLeave <= 10 };
}
