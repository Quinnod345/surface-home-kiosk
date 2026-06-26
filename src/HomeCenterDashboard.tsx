import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Camera,
  Car,
  ChevronRight,
  Fan,
  Flame,
  Home,
  Lightbulb,
  MapPin,
  Minus,
  Music,
  Plus,
  Power,
  ShoppingCart,
  Snowflake,
  Thermometer,
  Video,
} from "lucide-react";
import type { KioskConfig, PersonProfile } from "./config";
import {
  friendlyStateName,
  getHomeAssistantCameraSnapshot,
  numericAttribute,
  type HaState,
} from "./homeAssistant";
import { EntitySheet, MediaCard, RoomView } from "./EntityControls";
import { CalendarView } from "./CalendarView";
import { GroceryView } from "./GroceryView";
import {
  type CalendarEvent,
  monthGridRange,
  useCalendarEvents,
  useCalendarSources,
} from "./useCalendar";
import { leaveStatus, useTravelTime } from "./travelApi";
import { WeatherGlance } from "./WeatherGlance";

type HomeCenterDashboardProps = {
  config: KioskConfig;
  states: HaState[];
  status: "idle" | "loading" | "ok" | "error";
  error: string | null;
  activePerson: PersonProfile | null;
  // Dashboard section keys the active person has hidden (see DASHBOARD_SECTIONS).
  hiddenSections?: string[];
  // Calendars the active person's calendar view should show (empty = all).
  calendarEntityIds?: string[];
  onCallService: (
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onOpenCamera: (entityId: string) => void;
  onRefresh: () => void;
  onSaveConfig: (next: KioskConfig) => void;
};

type RoomDefinition = {
  id: string;
  label: string;
  keywords: string[];
  // When set, the room's lights are this curated list (group helper + named
  // fixtures) instead of every keyword-matched light. A curated light only
  // appears in its own room, even if another room's keywords would match it.
  lightEntityIds?: string[];
};

const ROOM_DEFINITIONS: RoomDefinition[] = [
  {
    id: "kitchen",
    label: "Kitchen",
    keywords: ["kitchen"],
    lightEntityIds: [
      "light.all_kitchen_lights",
      "light.kitchen_overhead",
      "light.kitchen_sink",
      "light.kitchen_island_2",
      "light.kitchen_island",
      "light.kitchen_table",
    ],
  },
  {
    id: "family-room",
    label: "Family Room",
    keywords: ["family room", "family_room"],
  },
  {
    id: "living-room",
    label: "Living Room",
    keywords: ["living room", "living_room"],
  },
  { id: "bedroom", label: "Bedroom", keywords: ["bedroom"] },
  {
    id: "master-bedroom",
    label: "Master Bedroom",
    keywords: ["master bedroom", "master_bedroom"],
  },
  {
    id: "quinn-bedroom",
    label: "Quinn's Bedroom",
    keywords: ["quinn", "quinn_s_bedroom", "quinn bedroom"],
    lightEntityIds: [
      "light.all_bedroom_lights",
      "light.bedroom_lamps",
      "light.bedroom_lamp_1",
      "light.bedroom_lamp_3",
      "light.bedroom_desk_lamp",
      "light.bedroom_desk_strip",
    ],
  },
  { id: "basement", label: "Basement", keywords: ["basement"] },
  {
    id: "dining-room",
    label: "Dining Room",
    keywords: ["dining room", "dining_room"],
  },
  { id: "theater", label: "Theater", keywords: ["theater"] },
  { id: "garage", label: "Garage", keywords: ["garage"] },
  { id: "outside", label: "Outside", keywords: ["outside", "yard", "driveway", "deck"] },
];

const DOMAIN_LABELS: Record<string, string> = {
  light: "lights",
  switch: "switches",
  binary_sensor: "sensors",
  climate: "climate",
  fan: "fans",
  media_player: "media",
  camera: "cameras",
};

function domainOf(state: HaState) {
  return state.entity_id.split(".")[0] ?? "";
}

function stateText(state: HaState) {
  return `${state.entity_id} ${friendlyStateName(state)}`.toLowerCase();
}

function isAvailable(state: HaState) {
  return state.state !== "unavailable" && state.state !== "unknown";
}

function isActiveState(state: HaState) {
  return ["on", "playing", "heat", "cool", "dry", "fan_only"].includes(state.state);
}

// A motion/occupancy/presence binary sensor — used to tell whether a room is
// "active" from people moving in it, not just devices being on.
function isMotionSensor(state: HaState): boolean {
  if (domainOf(state) !== "binary_sensor") return false;
  const deviceClass = state.attributes?.device_class;
  return (
    typeof deviceClass === "string" &&
    ["motion", "occupancy", "presence"].includes(deviceClass)
  );
}

function roomHasMotion(states: HaState[]): boolean {
  return states.some((state) => isMotionSensor(state) && state.state === "on");
}

// Devices actively doing something, excluding raw binary sensors (a motion
// sensor being "on" shouldn't read as a "device active").
function activeDeviceCount(states: HaState[]): number {
  return states.filter((state) => isActiveState(state) && domainOf(state) !== "binary_sensor")
    .length;
}

function matchesRoom(state: HaState, room: RoomDefinition) {
  const text = stateText(state);
  return room.keywords.some((keyword) => text.includes(keyword));
}

// Every light that has been hand-assigned to some room — these appear only in
// the room that claims them, never via another room's keyword match.
const CURATED_LIGHT_IDS = new Set(
  ROOM_DEFINITIONS.flatMap((room) => room.lightEntityIds ?? []),
);

function roomStates(states: HaState[], room: RoomDefinition) {
  const ownLights = new Set(room.lightEntityIds ?? []);
  return states.filter((state) => {
    if (!isAvailable(state)) return false;
    if (ownLights.has(state.entity_id)) return true;
    // A curated light belongs to exactly one room.
    if (CURATED_LIGHT_IDS.has(state.entity_id)) return false;
    if (!matchesRoom(state, room)) return false;
    // If this room curates its lights, drop keyword-matched lights not on the list.
    if (room.lightEntityIds && domainOf(state) === "light") return false;
    return true;
  });
}

function selectPrimaryEntity(states: HaState[], domain: "light" | "switch") {
  const candidates = states.filter((state) => domainOf(state) === domain);
  if (candidates.length === 0) return null;

  return (
    candidates.find((state) => /all|group|overhead|main/i.test(friendlyStateName(state))) ??
    candidates[0]
  );
}

function entityCounts(states: HaState[]) {
  const counts = new Map<string, { total: number; active: number }>();

  for (const state of states) {
    const domain = domainOf(state);
    const current = counts.get(domain) ?? { total: 0, active: 0 };
    current.total += 1;
    if (isActiveState(state)) current.active += 1;
    counts.set(domain, current);
  }

  return Array.from(counts.entries())
    .filter(([domain]) => DOMAIN_LABELS[domain])
    .sort(([left], [right]) => left.localeCompare(right));
}

function sortByName(left: HaState, right: HaState) {
  return friendlyStateName(left).localeCompare(friendlyStateName(right));
}

// While a popup is open, poll that one entity directly so its controls reflect
// changes within ~1.2s instead of waiting for the slow whole-dashboard poll.
function useLiveEntity(entityId: string | null, fallback: HaState | null): HaState | null {
  const [fresh, setFresh] = useState<HaState | null>(null);
  useEffect(() => {
    setFresh(null);
    if (!entityId || !window.surfaceKiosk?.getHomeAssistantState) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const state = (await window.surfaceKiosk!.getHomeAssistantState(entityId)) as HaState | null;
        if (!cancelled && state && state.entity_id === entityId) setFresh(state);
      } catch {
        // keep the fallback
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [entityId]);
  return fresh && fresh.entity_id === entityId ? fresh : fallback;
}

// A live camera thumbnail that refreshes its snapshot on an interval. Snapshots
// come through IPC as data URLs (the proxy needs the HA token), so a plain <img>
// src won't work without this.
function CameraPreview({
  entityId,
  name,
  config,
  index,
  onOpen,
}: {
  entityId: string;
  name: string;
  config: KioskConfig;
  index: number;
  onOpen: (entityId: string) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;
    const load = async () => {
      try {
        const next = await getHomeAssistantCameraSnapshot(config, entityId);
        if (!cancelled) {
          setUrl(next);
          setFailed(false);
        }
      } catch {
        if (!cancelled && !url) setFailed(true);
      }
    };
    // Stagger initial loads so 8 cameras don't all decode at once on the weak GPU.
    const startTimer = window.setTimeout(() => {
      void load();
      interval = window.setInterval(load, 15000);
    }, index * 350);
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      if (interval) window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  return (
    <button type="button" className="camera-tile" onClick={() => onOpen(entityId)}>
      {url ? (
        <img className="camera-tile-img" src={url} alt="" draggable={false} />
      ) : (
        <div className="camera-tile-fallback">
          <Video size={20} />
          {failed ? <span>Offline</span> : null}
        </div>
      )}
      <span className="camera-tile-name">{name}</span>
    </button>
  );
}

function eventTimeLabel(event: CalendarEvent): string {
  if (event.allDay || !event.start) return "All day";
  return new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// True if the event occupies `day` (handles multi-day and all-day spans).
function eventCoversDay(event: CalendarEvent, day: Date): boolean {
  if (!event.start) return false;
  const startDay = new Date(event.start);
  startDay.setHours(0, 0, 0, 0);
  const target = new Date(day);
  target.setHours(0, 0, 0, 0);
  let lastDay = new Date(startDay);
  if (event.end) {
    const end = new Date(event.end);
    if (event.allDay) end.setDate(end.getDate() - 1); // all-day end is exclusive
    end.setHours(0, 0, 0, 0);
    lastDay = end < startDay ? startDay : end;
  }
  return target >= startDay && target <= lastDay;
}

function AgendaRow({
  event,
  index,
  travelEnabled,
  bufferMin,
}: {
  event: CalendarEvent;
  index: number;
  travelEnabled: boolean;
  bufferMin: number;
}) {
  const hasLocation = !!event.location && travelEnabled;
  const travel = useTravelTime(hasLocation ? event.location : null, hasLocation);
  const leave = travel && travel.ok ? leaveStatus(event, travel.durationMin, bufferMin, Date.now()) : null;

  return (
    <div
      className={`agenda-row ${leave?.urgent ? "urgent" : ""}`}
      style={{ ["--cal-color" as string]: event.color, ["--i" as string]: index }}
    >
      <span className="agenda-rail" />
      <span className="agenda-time">{eventTimeLabel(event)}</span>
      <span className="agenda-body">
        <strong>{event.summary}</strong>
        {event.location ? (
          <span className="agenda-meta">
            <MapPin size={12} /> {event.location}
          </span>
        ) : null}
        {travel && travel.ok ? (
          <span className={`agenda-travel ${leave?.urgent ? "urgent" : ""}`}>
            <Car size={12} />
            {travel.durationMin} min away{leave ? ` · ${leave.label}` : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function TodayAgenda({
  events,
  travelEnabled,
  bufferMin,
  onOpen,
}: {
  events: CalendarEvent[];
  travelEnabled: boolean;
  bufferMin: number;
  onOpen: () => void;
}) {
  // Re-render each minute so "Leave in N min" stays current without poking the
  // (heavy, memoized) dashboard.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="dashboard-band agenda-card" role="button" tabIndex={0} onClick={onOpen}>
      <div className="section-heading">
        <CalendarDays size={18} />
        <h2>Today</h2>
        <ChevronRight size={16} className="agenda-chevron" />
      </div>
      {events.length ? (
        <div className="agenda-today-list">
          {events.map((event, index) => (
            <AgendaRow
              key={`${event.calendarId}-${event.uid ?? index}`}
              event={event}
              index={index}
              travelEnabled={travelEnabled}
              bufferMin={bufferMin}
            />
          ))}
        </div>
      ) : (
        <div className="agenda-empty">Nothing scheduled today</div>
      )}
    </div>
  );
}

function climateTemperature(state: HaState) {
  return (
    numericAttribute(state, "temperature") ??
    numericAttribute(state, "target_temp_high") ??
    numericAttribute(state, "current_temperature")
  );
}

function roundTemperature(value: number | null) {
  if (value === null) return "--";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function cameraScore(state: HaState) {
  const text = stateText(state);
  if (text.includes("doorbell")) return 0;
  if (text.includes("driveway")) return 1;
  if (text.includes("front")) return 2;
  if (text.includes("side")) return 3;
  if (text.includes("backyard")) return 4;
  return 5;
}

function HomeCenterDashboardComponent({
  config,
  states,
  status,
  error,
  activePerson,
  hiddenSections,
  calendarEntityIds,
  onCallService,
  onOpenCamera,
  onRefresh,
  onSaveConfig,
}: HomeCenterDashboardProps) {
  const [view, setView] = useState<"home" | "calendar" | "grocery">("home");
  // A section is shown unless this person has hidden it.
  const hidden = useMemo(() => new Set(hiddenSections ?? []), [hiddenSections]);
  const showSection = useCallback((key: string) => !hidden.has(key), [hidden]);

  // Prefetch this month's events (off the render thread, via IPC) so the calendar
  // opens instantly and the dashboard agenda has data immediately. The fetch is
  // cached and keyed identically to the calendar view, so opening it is a cache hit.
  const calendarSources = useCalendarSources(config, states);
  const calendarEnabled = config.calendar?.enabled ?? false;
  const calRange = useMemo(() => monthGridRange(new Date()), []);
  const { events: monthEvents } = useCalendarEvents(
    calendarSources,
    calRange.startISO,
    calRange.endISO,
    calendarEnabled,
  );
  const todayEvents = useMemo(() => {
    const now = new Date();
    return monthEvents
      .filter((event) => eventCoversDay(event, now))
      .filter(
        (event) =>
          event.allDay ||
          !event.start ||
          new Date(event.start).getTime() >= now.getTime() - 3_600_000,
      )
      .slice(0, 5);
  }, [monthEvents]);

  const weatherState = useMemo(() => {
    if (!(config.weather?.enabled ?? false)) return null;
    const id = config.weather?.entityId;
    return (
      states.find((s) => s.entity_id === id) ??
      states.find((s) => s.entity_id.startsWith("weather.")) ??
      null
    );
  }, [states, config.weather?.enabled, config.weather?.entityId]);
  // These derivations scan every Home Assistant entity (~1900 of them). Memoize
  // on `states` so they only run when a poll actually changes the data, not on
  // every unrelated re-render.
  const { rooms, climates, fans, mediaPlayers, cameras, scenes } = useMemo(() => {
    const derivedRooms = ROOM_DEFINITIONS.map((room) => ({
      room,
      states: roomStates(states, room),
    })).filter(({ states: currentStates }) => currentStates.length > 0);

    const derivedClimates = states
      .filter((state) => domainOf(state) === "climate" && isAvailable(state))
      .sort(sortByName);
    const derivedFans = states
      .filter((state) => domainOf(state) === "fan" && isAvailable(state))
      .sort(sortByName);
    const derivedMedia = states
      .filter((state) => domainOf(state) === "media_player" && isAvailable(state))
      .sort((left, right) => {
        const activeDelta = Number(isActiveState(right)) - Number(isActiveState(left));
        return activeDelta || sortByName(left, right);
      })
      .slice(0, 6);
    const derivedCameras = states
      .filter((state) => domainOf(state) === "camera" && isAvailable(state))
      .sort((left, right) => cameraScore(left) - cameraScore(right) || sortByName(left, right))
      .slice(0, 8);
    const derivedScenes = states
      .filter((state) => domainOf(state) === "scene")
      .sort(sortByName);

    return {
      rooms: derivedRooms,
      climates: derivedClimates,
      fans: derivedFans,
      mediaPlayers: derivedMedia,
      cameras: derivedCameras,
      scenes: derivedScenes,
    };
  }, [states]);

  const [openRoom, setOpenRoom] = useState<RoomDefinition | null>(null);
  const [openEntityId, setOpenEntityId] = useState<string | null>(null);
  const [closingEntity, setClosingEntity] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const closeEntity = useCallback(() => {
    setClosingEntity(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setOpenEntityId(null);
      setClosingEntity(false);
    }, 190);
  }, []);
  const openEntityStateRaw = useMemo(
    () => (openEntityId ? states.find((s) => s.entity_id === openEntityId) ?? null : null),
    [openEntityId, states],
  );
  // Fast-poll the open entity so its controls update quickly.
  const openEntityState = useLiveEntity(openEntityId, openEntityStateRaw);

  // Resolve the open room's entities/scenes against the live states so controls
  // reflect the latest values while the sheet is open.
  const openRoomData = useMemo(() => {
    if (!openRoom) return null;
    const roomEntities = roomStates(states, openRoom);
    const roomScenes = scenes.filter((scene) =>
      openRoom.keywords.some((keyword) => stateText(scene).includes(keyword)),
    );
    return { entities: roomEntities, scenes: roomScenes };
  }, [openRoom, scenes, states]);

  async function toggleRoom(roomCurrentStates: HaState[]) {
    const primaryLight = selectPrimaryEntity(roomCurrentStates, "light");
    const primarySwitch = selectPrimaryEntity(roomCurrentStates, "switch");
    const primary = primaryLight ?? primarySwitch;
    if (!primary) return;

    const domain = domainOf(primary);
    const roomLights = roomCurrentStates.filter((state) => domainOf(state) === domain);
    const anyActive = roomLights.some(isActiveState);
    await onCallService(domain, anyActive ? "turn_off" : "turn_on", {
      entity_id: primary.entity_id,
    });
  }

  async function adjustClimate(state: HaState, delta: number) {
    const current = climateTemperature(state);
    if (current === null) return;

    await onCallService("climate", "set_temperature", {
      entity_id: state.entity_id,
      temperature: Math.round((current + delta) * 10) / 10,
    });
  }

  async function adjustFan(state: HaState, direction: number) {
    // Fans snap to discrete speeds (percentage_step, often 25%). Nudging by a
    // smaller amount rounds back to the same speed, so step by the entity's own
    // increment instead.
    const step = numericAttribute(state, "percentage_step") || 25;
    const current = numericAttribute(state, "percentage") ?? (isActiveState(state) ? step : 0);
    const next = Math.max(0, Math.min(100, Math.round((current + direction * step) / step) * step));

    if (next <= 0) {
      await onCallService("fan", "turn_off", { entity_id: state.entity_id });
      return;
    }
    await onCallService("fan", "set_percentage", {
      entity_id: state.entity_id,
      percentage: next,
    });
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const activeRoomCount = rooms.filter(
    (entry) => activeDeviceCount(entry.states) > 0 || roomHasMotion(entry.states),
  ).length;
  const heroSummary =
    activeRoomCount > 0
      ? `${activeRoomCount} ${activeRoomCount === 1 ? "room" : "rooms"} active`
      : "All quiet at home";

  // Toggle to a view, or back to the dashboard if it's already showing. Refresh
  // HA states when leaving the calendar (preserves the prior behaviour).
  const selectView = (target: "calendar" | "grocery") => {
    setView((current) => {
      if (current === "calendar" && target !== "calendar") onRefresh();
      return current === target ? "home" : target;
    });
  };

  const heroSub =
    view === "calendar" ? "Calendar" : view === "grocery" ? "Groceries" : heroSummary;

  return (
    <div className="home-center">
      <header className="home-hero">
        <div>
          {/* Keyed on the person so a new face recognized mid-session re-greets
              (and the per-user theme on .app updates) with a welcome animation. */}
          <span className="hero-greeting" key={activePerson?.id ?? "home"}>
            {greeting}
            {activePerson ? `, ${activePerson.displayName.split(" ")[0]}` : ""}
          </span>
          <span className="hero-sub">{heroSub}</span>
        </div>
        <div className="hero-right">
          {showSection("weather") ? (
            <WeatherGlance state={weatherState} variant="hero" />
          ) : null}
          {config.grocery?.enabled && showSection("grocery") ? (
            <button
              type="button"
              className={`icon-action ${view === "grocery" ? "active" : ""}`}
              aria-label={view === "grocery" ? "Back to dashboard" : "Open groceries"}
              onClick={() => selectView("grocery")}
            >
              <ShoppingCart size={18} />
            </button>
          ) : null}
          {config.calendar?.enabled && showSection("calendar") ? (
            <button
              type="button"
              className={`icon-action ${view === "calendar" ? "active" : ""}`}
              aria-label={view === "calendar" ? "Back to dashboard" : "Open calendar"}
              onClick={() => selectView("calendar")}
            >
              <CalendarDays size={18} />
            </button>
          ) : null}
        </div>
      </header>

      {view === "calendar" ? (
        <div className="home-body" key="calendar">
          <CalendarView
            config={config}
            states={states}
            calendarEntityIds={calendarEntityIds}
            onSaveConfig={onSaveConfig}
          />
        </div>
      ) : view === "grocery" ? (
        <div className="home-body" key="grocery">
          <GroceryView config={config} onCallService={onCallService} />
        </div>
      ) : (
        <div className="home-body" key="home">
      <div className="home-center-grid">
        <section className="dashboard-column" aria-label="Rooms and media">
          {openRoom && openRoomData ? (
            <div className="room-detail" key={openRoom.id}>
              <RoomView
                label={openRoom.label}
                states={openRoomData.entities}
                scenes={openRoomData.scenes}
                onCall={onCallService}
                onBack={() => setOpenRoom(null)}
                baseUrl={config.homeAssistant.baseUrl}
                motion={roomHasMotion(openRoomData.entities)}
              />
            </div>
          ) : (
          <>
          {showSection("rooms") ? (
          <>
          <div className="section-heading">
            <Home size={18} />
            <h2>Rooms</h2>
          </div>

          <div className="room-grid">
            {rooms.slice(0, 8).map(({ room, states: currentStates }) => {
              const lightsOn = currentStates.filter(
                (state) => domainOf(state) === "light" && isActiveState(state),
              ).length;
              const devicesActive = activeDeviceCount(currentStates);
              const motion = roomHasMotion(currentStates);
              const isOn = devicesActive > 0 || motion;
              const primary =
                selectPrimaryEntity(currentStates, "light") ??
                selectPrimaryEntity(currentStates, "switch");
              const status =
                lightsOn > 0
                  ? `${lightsOn} ${lightsOn === 1 ? "light" : "lights"} on`
                  : devicesActive > 0
                    ? `${devicesActive} active`
                    : motion
                      ? "Motion now"
                      : "Quiet";

              return (
                <article
                  className={`room-card ${isOn ? "is-on" : ""} ${motion ? "has-motion" : ""}`}
                  key={room.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenRoom(room)}
                >
                  <div className="room-card-top">
                    <h3>{room.label}</h3>
                    <button
                      type="button"
                      aria-label={`Toggle ${room.label}`}
                      disabled={!primary}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleRoom(currentStates);
                      }}
                    >
                      <Lightbulb size={18} />
                    </button>
                  </div>
                  <span className="room-status">
                    {motion ? <span className="motion-dot" /> : null}
                    {status}
                  </span>
                </article>
              );
            })}
          </div>
          </>
          ) : null}

          {showSection("media") ? (
          <div className="dashboard-band">
            <div className="section-heading">
              <Music size={18} />
              <h2>Media</h2>
            </div>
            <div className="media-grid">
              {mediaPlayers.slice(0, 4).map((player) => (
                <MediaCard
                  key={player.entity_id}
                  player={player}
                  onCall={onCallService}
                  baseUrl={config.homeAssistant.baseUrl}
                  onOpen={() => setOpenEntityId(player.entity_id)}
                />
              ))}
            </div>
          </div>
          ) : null}
          </>
          )}
        </section>

        <section className="dashboard-column" aria-label="Today, cameras and climate">
          {calendarEnabled && showSection("agenda") ? (
            <TodayAgenda
              events={todayEvents}
              travelEnabled={config.travel?.provider === "mapbox"}
              bufferMin={config.travel?.leaveBufferMinutes ?? 30}
              onOpen={() => setView("calendar")}
            />
          ) : null}

          {cameras.length && showSection("cameras") ? (
            <div className="dashboard-band">
              <div className="section-heading">
                <Camera size={18} />
                <h2>Cameras</h2>
              </div>
              <div className="camera-grid">
                {cameras.map((camera, index) => (
                  <CameraPreview
                    key={camera.entity_id}
                    entityId={camera.entity_id}
                    name={friendlyStateName(camera)}
                    config={config}
                    index={index}
                    onOpen={onOpenCamera}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {showSection("climate") ? (
          <>
          <div className="section-heading">
            <Thermometer size={18} />
            <h2>Climate</h2>
          </div>

          <div className="climate-grid">
            {climates.map((climate) => {
              const current = numericAttribute(climate, "current_temperature");
              const target = climateTemperature(climate);
              // hvac_action reflects what the unit is ACTIVELY doing right now
              // ("heating"/"cooling"/"idle"/"off") vs the mode it's merely set to.
              const hvacAction =
                typeof climate.attributes?.hvac_action === "string"
                  ? (climate.attributes.hvac_action as string)
                  : null;

              return (
                <article
                  className={`climate-card mode-${climate.state} ${
                    hvacAction ? `action-${hvacAction}` : ""
                  }`}
                  key={climate.entity_id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenEntityId(climate.entity_id)}
                >
                  <div className="climate-card-main">
                    <div>
                      <h3>{friendlyStateName(climate)}</h3>
                      <span className="climate-state">
                        {hvacAction === "cooling" ? (
                          <>
                            <Snowflake size={13} className="hvac-icon cooling" /> Cooling
                          </>
                        ) : hvacAction === "heating" ? (
                          <>
                            <Flame size={13} className="hvac-icon heating" /> Heating
                          </>
                        ) : (
                          climate.state.replace(/_/g, " · ")
                        )}
                      </span>
                    </div>
                    <div className="temperature-readout">
                      <strong>{roundTemperature(target)}&deg;</strong>
                      <span>set</span>
                    </div>
                  </div>
                  <div className="climate-controls">
                    <span>
                      <Flame size={16} />
                      {roundTemperature(current)} now
                    </span>
                    <div>
                      <button
                        type="button"
                        aria-label={`Lower ${friendlyStateName(climate)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void adjustClimate(climate, -1);
                        }}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Raise ${friendlyStateName(climate)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void adjustClimate(climate, 1);
                        }}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          </>
          ) : null}

          {showSection("fans") ? (
          <>
          {fans.length ? (
            <div className="section-heading fan-heading">
              <Fan size={18} />
              <h2>Fans</h2>
            </div>
          ) : null}

          <div className="fan-grid">
            {fans.map((fan) => {
              const percentage = numericAttribute(fan, "percentage");
              return (
                <article
                  className={`climate-card fan-card ${isActiveState(fan) ? "is-on" : ""}`}
                  key={fan.entity_id}
                >
                  <div className="climate-card-main">
                    <div>
                      <h3>{friendlyStateName(fan)}</h3>
                      <span>{fan.state}</span>
                    </div>
                    <Fan
                      size={28}
                      className={isActiveState(fan) ? "fan-spin" : ""}
                      style={
                        isActiveState(fan)
                          ? { animationDuration: `${Math.max(0.45, 1.8 - ((percentage ?? 50) / 100) * 1.3)}s` }
                          : undefined
                      }
                    />
                  </div>
                  <div className="climate-controls">
                    <span>{percentage === null ? "speed" : `${Math.round(percentage)}%`}</span>
                    <div>
                      <button
                        type="button"
                        aria-label={`Slow ${friendlyStateName(fan)}`}
                        onClick={() => void adjustFan(fan, -1)}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Toggle ${friendlyStateName(fan)}`}
                        onClick={() =>
                          void onCallService("fan", "toggle", {
                            entity_id: fan.entity_id,
                          })
                        }
                      >
                        <Power size={17} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Speed up ${friendlyStateName(fan)}`}
                        onClick={() => void adjustFan(fan, 1)}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          </>
          ) : null}

          <div className="dashboard-band home-assistant-status">
            <span className={`status-dot ${status === "ok" ? "ok" : status === "error" ? "error" : ""}`} />
            <div>
              <strong>{status === "ok" ? `${states.length} entities` : "Home Assistant"}</strong>
              <span>{error ?? config.homeAssistant.baseUrl}</span>
            </div>
          </div>
        </section>
      </div>
        </div>
      )}

      {openEntityState ? (
        <div
          className={`sheet-backdrop ${closingEntity ? "closing" : ""}`}
          onPointerDown={closeEntity}
        >
          <EntitySheet
            state={openEntityState}
            onCall={onCallService}
            onClose={closeEntity}
            baseUrl={config.homeAssistant.baseUrl}
          />
        </div>
      ) : null}
    </div>
  );
}

export const HomeCenterDashboard = memo(HomeCenterDashboardComponent);
