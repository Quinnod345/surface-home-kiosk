import {
  Camera,
  Fan,
  Flame,
  Home,
  Lightbulb,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Power,
  RefreshCw,
  Thermometer,
  Video,
} from "lucide-react";
import type { KioskConfig, PersonProfile } from "./config";
import {
  friendlyStateName,
  numericAttribute,
  type HaState,
} from "./homeAssistant";

type HomeCenterDashboardProps = {
  config: KioskConfig;
  states: HaState[];
  status: "idle" | "loading" | "ok" | "error";
  error: string | null;
  activePerson: PersonProfile | null;
  onCallService: (
    domain: string,
    service: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onOpenCamera: (entityId: string) => void;
  onRefresh: () => void;
};

type RoomDefinition = {
  id: string;
  label: string;
  keywords: string[];
};

const ROOM_DEFINITIONS: RoomDefinition[] = [
  { id: "kitchen", label: "Kitchen", keywords: ["kitchen"] },
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

function matchesRoom(state: HaState, room: RoomDefinition) {
  const text = stateText(state);
  return room.keywords.some((keyword) => text.includes(keyword));
}

function roomStates(states: HaState[], room: RoomDefinition) {
  return states.filter((state) => matchesRoom(state, room) && isAvailable(state));
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

function mediaSubtitle(state: HaState) {
  const title = state.attributes?.media_title;
  const appName = state.attributes?.app_name;
  if (typeof title === "string" && title) return title;
  if (typeof appName === "string" && appName) return appName;
  return state.state;
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

export function HomeCenterDashboard({
  config,
  states,
  status,
  error,
  activePerson,
  onCallService,
  onOpenCamera,
  onRefresh,
}: HomeCenterDashboardProps) {
  const rooms = ROOM_DEFINITIONS.map((room) => ({
    room,
    states: roomStates(states, room),
  })).filter(({ states: currentStates }) => currentStates.length > 0);

  const climates = states
    .filter((state) => domainOf(state) === "climate" && isAvailable(state))
    .sort(sortByName);
  const fans = states
    .filter((state) => domainOf(state) === "fan" && isAvailable(state))
    .sort(sortByName);
  const mediaPlayers = states
    .filter((state) => domainOf(state) === "media_player" && isAvailable(state))
    .sort((left, right) => {
      const activeDelta = Number(isActiveState(right)) - Number(isActiveState(left));
      return activeDelta || sortByName(left, right);
    })
    .slice(0, 6);
  const cameras = states
    .filter((state) => domainOf(state) === "camera" && isAvailable(state))
    .sort((left, right) => cameraScore(left) - cameraScore(right) || sortByName(left, right))
    .slice(0, 6);

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

  async function adjustFan(state: HaState, delta: number) {
    const current = numericAttribute(state, "percentage") ?? (isActiveState(state) ? 50 : 0);
    const next = Math.max(0, Math.min(100, current + delta));
    await onCallService("fan", "set_percentage", {
      entity_id: state.entity_id,
      percentage: next,
    });
  }

  return (
    <div className="home-center">
      <header className="home-center-header">
        <div>
          <span className="eyebrow">Home</span>
          <h1>{activePerson ? `${activePerson.displayName}'s dashboard` : "Home center"}</h1>
        </div>
        <button type="button" className="icon-action" aria-label="Refresh" onClick={onRefresh}>
          <RefreshCw size={19} />
        </button>
      </header>

      <div className="home-center-grid">
        <section className="dashboard-column" aria-label="Rooms and media">
          <div className="section-heading">
            <Home size={18} />
            <h2>Rooms</h2>
          </div>

          <div className="room-grid">
            {rooms.slice(0, 8).map(({ room, states: currentStates }) => {
              const counts = entityCounts(currentStates);
              const activeCount = currentStates.filter(isActiveState).length;
              const primary = selectPrimaryEntity(currentStates, "light") ??
                selectPrimaryEntity(currentStates, "switch");

              return (
                <article className="room-card" key={room.id}>
                  <div className="room-card-main">
                    <div>
                      <h3>{room.label}</h3>
                      <span>{activeCount > 0 ? `${activeCount} active` : "quiet"}</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Toggle ${room.label}`}
                      disabled={!primary}
                      onClick={() => void toggleRoom(currentStates)}
                    >
                      <Lightbulb size={18} />
                    </button>
                  </div>
                  <div className="room-metrics">
                    {counts.slice(0, 3).map(([domain, count]) => (
                      <span key={domain}>
                        <strong>{count.active}</strong>
                        {DOMAIN_LABELS[domain] ?? domain}
                      </span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="dashboard-band">
            <div className="section-heading">
              <Music size={18} />
              <h2>Media</h2>
            </div>
            <div className="media-list">
              {mediaPlayers.slice(0, 4).map((player) => (
                <article className="media-row" key={player.entity_id}>
                  <div>
                    <strong>{friendlyStateName(player)}</strong>
                    <span>{mediaSubtitle(player)}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Toggle ${friendlyStateName(player)}`}
                    onClick={() =>
                      void onCallService("media_player", "media_play_pause", {
                        entity_id: player.entity_id,
                      })
                    }
                  >
                    {player.state === "playing" ? <Pause size={17} /> : <Play size={17} />}
                  </button>
                </article>
              ))}
            </div>
          </div>

          <div className="dashboard-band">
            <div className="section-heading">
              <Camera size={18} />
              <h2>Cameras</h2>
            </div>
            <div className="camera-shortcuts">
              {cameras.map((camera) => (
                <button
                  type="button"
                  key={camera.entity_id}
                  onClick={() => onOpenCamera(camera.entity_id)}
                >
                  <Video size={18} />
                  <span>{friendlyStateName(camera)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="dashboard-column" aria-label="Climate and comfort">
          <div className="section-heading">
            <Thermometer size={18} />
            <h2>Climate</h2>
          </div>

          <div className="climate-stack">
            {climates.map((climate) => {
              const current = numericAttribute(climate, "current_temperature");
              const target = climateTemperature(climate);

              return (
                <article className="climate-card" key={climate.entity_id}>
                  <div className="climate-card-main">
                    <div>
                      <h3>{friendlyStateName(climate)}</h3>
                      <span>{climate.state}</span>
                    </div>
                    <div className="temperature-readout">
                      <strong>{roundTemperature(target)}</strong>
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
                        onClick={() => void adjustClimate(climate, -1)}
                      >
                        <Minus size={18} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Raise ${friendlyStateName(climate)}`}
                        onClick={() => void adjustClimate(climate, 1)}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}

            {fans.map((fan) => {
              const percentage = numericAttribute(fan, "percentage");
              return (
                <article className="climate-card fan-card" key={fan.entity_id}>
                  <div className="climate-card-main">
                    <div>
                      <h3>{friendlyStateName(fan)}</h3>
                      <span>{fan.state}</span>
                    </div>
                    <Fan size={28} />
                  </div>
                  <div className="climate-controls">
                    <span>{percentage === null ? "speed" : `${Math.round(percentage)}%`}</span>
                    <div>
                      <button
                        type="button"
                        aria-label={`Slow ${friendlyStateName(fan)}`}
                        onClick={() => void adjustFan(fan, -10)}
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
                        onClick={() => void adjustFan(fan, 10)}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

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
  );
}
