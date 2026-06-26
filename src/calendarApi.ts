import type { KioskConfig } from "./config";
import { callHomeAssistantService } from "./homeAssistant";
import type { CalendarEvent } from "./useCalendar";

export type EventDraft = {
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  // For timed events: ISO local datetime strings ("2026-06-25T14:00:00").
  // For all-day events: date strings ("2026-06-25"), end exclusive.
  start: string;
  end: string;
};

// HA's calendar.create_event wants naive local datetimes (no timezone suffix);
// the server interprets them in its own configured timezone.
function localDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:00`
  );
}

export function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function draftFromDate(calendarId: string, day: Date): EventDraft {
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setHours(10, 0, 0, 0);
  return {
    calendarId,
    summary: "",
    description: "",
    location: "",
    allDay: false,
    start: localDateTime(start),
    end: localDateTime(end),
  };
}

export function draftFromEvent(event: CalendarEvent): EventDraft {
  if (event.allDay) {
    const startDay = event.start ? event.start.slice(0, 10) : localDateString(new Date());
    const endDay = event.end ? event.end.slice(0, 10) : startDay;
    return {
      calendarId: event.calendarId,
      summary: event.summary,
      description: event.description,
      location: event.location,
      allDay: true,
      start: startDay,
      end: endDay,
    };
  }
  const start = event.start ? new Date(event.start) : new Date();
  const end = event.end ? new Date(event.end) : new Date(start.getTime() + 3_600_000);
  return {
    calendarId: event.calendarId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    allDay: false,
    start: localDateTime(start),
    end: localDateTime(end),
  };
}

export async function createCalendarEvent(config: KioskConfig, draft: EventDraft): Promise<void> {
  const payload: Record<string, unknown> = {
    entity_id: draft.calendarId,
    summary: draft.summary.trim() || "Untitled",
  };
  if (draft.description.trim()) payload.description = draft.description.trim();
  if (draft.location.trim()) payload.location = draft.location.trim();

  if (draft.allDay) {
    payload.start_date = draft.start;
    payload.end_date = draft.end;
  } else {
    payload.start_date_time = draft.start;
    payload.end_date_time = draft.end;
  }

  const result = await callHomeAssistantService(config, "calendar", "create_event", payload);
  if (!result.ok) throw new Error(result.error ?? "Could not create event");
}

export async function deleteCalendarEvent(event: CalendarEvent): Promise<void> {
  if (!event.uid) throw new Error("This event can't be deleted (no id).");
  if (!window.surfaceKiosk?.deleteCalendarEvent) {
    throw new Error("Event delete is only available on the kiosk device.");
  }
  await window.surfaceKiosk.deleteCalendarEvent(
    event.calendarId,
    event.uid,
    event.recurrenceId ?? null,
    event.recurrenceId ? "thisevent" : null,
  );
}

// No HA calendar supports in-place UPDATE over the API, so an edit is a delete of
// the original followed by a create of the revised event.
export async function updateCalendarEvent(
  config: KioskConfig,
  original: CalendarEvent,
  draft: EventDraft,
): Promise<void> {
  await deleteCalendarEvent(original);
  await createCalendarEvent(config, draft);
}
