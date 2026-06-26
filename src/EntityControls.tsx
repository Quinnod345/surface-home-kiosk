import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  DoorClosed,
  DoorOpen,
  Fan,
  Lightbulb,
  Lock,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Power,
  Radar,
  SkipBack,
  SkipForward,
  Sparkles,
  Square,
  Thermometer,
  Unlock,
  Volume2,
  X,
} from "lucide-react";
import { friendlyStateName, numericAttribute, type HaState } from "./homeAssistant";

export type CallService = (
  domain: string,
  service: string,
  payload: Record<string, unknown>,
) => Promise<void> | void;

function domainOf(state: HaState) {
  return state.entity_id.split(".")[0] ?? "";
}

function isOn(state: HaState) {
  return ["on", "open", "unlocked", "playing", "home", "heat", "cool"].includes(state.state);
}

function listAttribute(state: HaState, key: string): string[] {
  const value = state.attributes?.[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

function stringAttribute(state: HaState, key: string): string | null {
  const value = state.attributes?.[key];
  return typeof value === "string" && value ? value : null;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// A range that tracks the finger locally and only calls the service on release,
// so dragging doesn't flood Home Assistant with service calls.
function CommitSlider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onCommit: (value: number) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const format = (n: number) => `${Math.round(n)}${suffix ?? ""}`;

  // Uncontrolled: the browser drives the thumb natively (buttery on weak GPUs).
  // We only sync from external updates (a poll) when the user isn't dragging.
  useEffect(() => {
    if (!draggingRef.current && inputRef.current) {
      inputRef.current.value = String(value);
      if (valueRef.current) valueRef.current.textContent = format(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, suffix]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  // Update the readout via direct DOM (no React re-render during the drag) and
  // commit debounced — on touch a range drag often never fires pointerup.
  const handleInput = (event: React.FormEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    draggingRef.current = true;
    if (valueRef.current) valueRef.current.textContent = format(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      draggingRef.current = false;
      onCommit(next);
    }, 220);
  };

  return (
    <label className={`control-slider ${className ?? ""}`}>
      <span>
        {label}
        <strong ref={valueRef}>{format(value)}</strong>
      </span>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onInput={handleInput}
      />
    </label>
  );
}

// White-balance presets send color_temp_kelvin (an RGB approximation of white
// looks bad), real colours send rgb_color.
const COLOR_TEMP_PRESETS: { label: string; kelvin: number; css: string }[] = [
  { label: "Warm", kelvin: 2700, css: "#ffb869" },
  { label: "Soft", kelvin: 3500, css: "#ffd6a5" },
  { label: "Neutral", kelvin: 4300, css: "#fff1dc" },
  { label: "Cool", kelvin: 5500, css: "#eaf3ff" },
  { label: "Daylight", kelvin: 6500, css: "#d6e8ff" },
];

const COLOR_SWATCHES: { label: string; rgb: [number, number, number] }[] = [
  { label: "Red", rgb: [255, 64, 64] },
  { label: "Orange", rgb: [255, 146, 48] },
  { label: "Yellow", rgb: [255, 214, 64] },
  { label: "Green", rgb: [78, 214, 122] },
  { label: "Teal", rgb: [64, 212, 198] },
  { label: "Blue", rgb: [80, 142, 255] },
  { label: "Purple", rgb: [170, 110, 255] },
  { label: "Pink", rgb: [255, 110, 196] },
];

function lightColor(state: HaState): string {
  const rgb = state.attributes?.rgb_color;
  if (Array.isArray(rgb) && rgb.length >= 3) {
    return `rgb(${Number(rgb[0])}, ${Number(rgb[1])}, ${Number(rgb[2])})`;
  }
  const kelvin = numericAttribute(state, "color_temp_kelvin");
  if (kelvin != null) {
    const t = Math.max(0, Math.min(1, (kelvin - 2200) / (6500 - 2200)));
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return `rgb(${lerp(255, 226)}, ${lerp(208, 236)}, ${lerp(156, 255)})`;
  }
  return "rgb(247, 185, 85)";
}

function LightControls({ state, onCall }: { state: HaState; onCall: CallService }) {
  const entity_id = state.entity_id;
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null);
  useEffect(() => {
    setOptimisticOn(null);
  }, [state.state]);
  const on = optimisticOn ?? state.state === "on";

  const brightness = numericAttribute(state, "brightness");
  const brightnessPct = brightness == null ? (on ? 100 : 0) : Math.round((brightness / 255) * 100);
  const colorModes = listAttribute(state, "supported_color_modes");
  const supportsTemp = colorModes.includes("color_temp");
  const supportsColor = colorModes.some((mode) =>
    ["hs", "rgb", "rgbw", "rgbww", "xy"].includes(mode),
  );
  const minK = numericAttribute(state, "min_color_temp_kelvin") ?? 2200;
  const maxK = numericAttribute(state, "max_color_temp_kelvin") ?? 6500;
  const curK = numericAttribute(state, "color_temp_kelvin") ?? Math.round((minK + maxK) / 2);
  const effects = listAttribute(state, "effect_list");
  const currentEffect = stringAttribute(state, "effect");
  const color = lightColor(state);

  const toggle = () => {
    const next = !on;
    setOptimisticOn(next);
    void onCall("light", next ? "turn_on" : "turn_off", { entity_id });
  };

  return (
    <div className="entity-controls light-controls">
      <button
        type="button"
        className={`light-orb ${on ? "on" : ""}`}
        onClick={toggle}
        style={on ? ({ "--lc": color } as CSSProperties) : undefined}
      >
        <strong>{on ? `${brightnessPct}%` : "Off"}</strong>
        <small>{on ? "Tap to turn off" : "Tap to turn on"}</small>
      </button>

      <CommitSlider
        className="brightness"
        label="Brightness"
        value={brightnessPct}
        min={1}
        max={100}
        step={1}
        suffix="%"
        onCommit={(pct) => void onCall("light", "turn_on", { entity_id, brightness_pct: pct })}
      />

      {supportsTemp ? (
        <CommitSlider
          className="warmth"
          label="Warmth"
          value={curK}
          min={minK}
          max={maxK}
          step={50}
          suffix="K"
          onCommit={(k) => void onCall("light", "turn_on", { entity_id, color_temp_kelvin: k })}
        />
      ) : null}

      {supportsTemp ? (
        <div className="swatch-row temp-row">
          {COLOR_TEMP_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.label}
              aria-label={preset.label}
              title={preset.label}
              style={{ background: preset.css }}
              onClick={() =>
                void onCall("light", "turn_on", {
                  entity_id,
                  color_temp_kelvin: Math.max(minK, Math.min(maxK, preset.kelvin)),
                })
              }
            />
          ))}
        </div>
      ) : null}

      {supportsColor ? (
        <div className="swatch-row">
          {COLOR_SWATCHES.map((swatch) => (
            <button
              type="button"
              key={swatch.label}
              aria-label={swatch.label}
              title={swatch.label}
              style={{ background: `rgb(${swatch.rgb.join(",")})` }}
              onClick={() => void onCall("light", "turn_on", { entity_id, rgb_color: swatch.rgb })}
            />
          ))}
        </div>
      ) : null}

      {effects.length ? (
        <div className="seg-row column">
          <span>Effect</span>
          <div className="chip-scroll">
            {effects.map((effect) => (
              <button
                type="button"
                key={effect}
                className={currentEffect === effect ? "active" : ""}
                onClick={() => void onCall("light", "turn_on", { entity_id, effect })}
              >
                {effect}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FanControls({ state, onCall }: { state: HaState; onCall: CallService }) {
  const entity_id = state.entity_id;
  const step = numericAttribute(state, "percentage_step") || 25;
  const pct = numericAttribute(state, "percentage") ?? (isOn(state) ? step : 0);
  const adjust = (direction: number) => {
    const next = Math.max(0, Math.min(100, Math.round((pct + direction * step) / step) * step));
    if (next <= 0) return void onCall("fan", "turn_off", { entity_id });
    return void onCall("fan", "set_percentage", { entity_id, percentage: next });
  };
  return (
    <div className="entity-controls">
      <button
        type="button"
        className={`big-toggle ${isOn(state) ? "on" : ""}`}
        onClick={() => void onCall("fan", "toggle", { entity_id })}
      >
        <Fan size={20} />
        <span>{isOn(state) ? `${Math.round(pct)}%` : "Off"}</span>
      </button>
      <div className="stepper">
        <button type="button" aria-label="Slower" onClick={() => adjust(-1)}>
          <Minus size={18} />
        </button>
        <button type="button" aria-label="Faster" onClick={() => adjust(1)}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

function CoverControls({ state, onCall }: { state: HaState; onCall: CallService }) {
  const entity_id = state.entity_id;
  return (
    <div className="entity-controls cover-controls">
      <button type="button" onClick={() => void onCall("cover", "open_cover", { entity_id })}>
        <DoorOpen size={18} /> Open
      </button>
      <button type="button" onClick={() => void onCall("cover", "stop_cover", { entity_id })}>
        <Square size={16} /> Stop
      </button>
      <button type="button" onClick={() => void onCall("cover", "close_cover", { entity_id })}>
        <DoorClosed size={18} /> Close
      </button>
    </div>
  );
}

function MediaControls({
  state,
  onCall,
  baseUrl,
}: {
  state: HaState;
  onCall: CallService;
  baseUrl?: string;
}) {
  const entity_id = state.entity_id;
  const volume = numericAttribute(state, "volume_level");
  const title = stringAttribute(state, "media_title");
  const subtitle =
    stringAttribute(state, "media_artist") ??
    stringAttribute(state, "media_series_title") ??
    stringAttribute(state, "app_name");
  const picture = stringAttribute(state, "entity_picture");
  const art = picture ? (picture.startsWith("http") ? picture : `${baseUrl ?? ""}${picture}`) : null;
  const playing = state.state === "playing";

  return (
    <div className="entity-controls">
      {art ? (
        <img
          className="album-art"
          src={art}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <div className="now-playing">
        <strong>{title ?? titleCase(state.state)}</strong>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>

      <div className="transport">
        <button
          type="button"
          aria-label="Previous"
          onClick={() => void onCall("media_player", "media_previous_track", { entity_id })}
        >
          <SkipBack size={20} />
        </button>
        <button
          type="button"
          aria-label="Play/pause"
          className={`transport-play ${playing ? "on" : ""}`}
          onClick={() => void onCall("media_player", "media_play_pause", { entity_id })}
        >
          {playing ? <Pause size={24} /> : <Play size={24} />}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={() => void onCall("media_player", "media_next_track", { entity_id })}
        >
          <SkipForward size={20} />
        </button>
      </div>

      {volume != null ? (
        <CommitSlider
          label="Volume"
          value={Math.round(volume * 100)}
          min={0}
          max={100}
          step={1}
          suffix="%"
          onCommit={(v) =>
            void onCall("media_player", "volume_set", { entity_id, volume_level: v / 100 })
          }
        />
      ) : null}
    </div>
  );
}

const HVAC_LABEL: Record<string, string> = {
  off: "Off",
  heat: "Heat",
  cool: "Cool",
  heat_cool: "Auto",
  auto: "Auto",
  dry: "Dry",
  fan_only: "Fan",
};

function ClimateControls({ state, onCall }: { state: HaState; onCall: CallService }) {
  const entity_id = state.entity_id;
  const current = numericAttribute(state, "current_temperature");
  const low = numericAttribute(state, "target_temp_low");
  const high = numericAttribute(state, "target_temp_high");
  const single = numericAttribute(state, "temperature");
  const step = numericAttribute(state, "target_temp_step") || 1;
  const min = numericAttribute(state, "min_temp") ?? 45;
  const max = numericAttribute(state, "max_temp") ?? 95;
  const modes = listAttribute(state, "hvac_modes");
  const fanModes = listAttribute(state, "fan_modes");
  const presets = listAttribute(state, "preset_modes");
  const action = stringAttribute(state, "hvac_action");
  const fanMode = stringAttribute(state, "fan_mode");
  const preset = stringAttribute(state, "preset_mode");
  const humidity = numericAttribute(state, "current_humidity");
  const swingModes = listAttribute(state, "swing_modes");
  const swing = stringAttribute(state, "swing_mode");
  const isRange = low != null && high != null;
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)) * 10) / 10;

  return (
    <div className="entity-controls climate-full">
      <div className="climate-now">
        <strong>{current != null ? `${Math.round(current)}°` : "—"}</strong>
        <span>{action ? titleCase(action) : "current"}</span>
        {humidity != null ? <span className="climate-humidity">{Math.round(humidity)}% RH</span> : null}
      </div>

      {isRange ? (
        <div className="setpoint-row">
          <div className="setpoint">
            <span>Heat to</span>
            <div className="stepper">
              <button
                type="button"
                aria-label="Lower heat"
                onClick={() =>
                  void onCall("climate", "set_temperature", {
                    entity_id,
                    target_temp_low: clamp(low! - step),
                    target_temp_high: high!,
                  })
                }
              >
                <Minus size={18} />
              </button>
              <strong>{Math.round(low!)}°</strong>
              <button
                type="button"
                aria-label="Raise heat"
                onClick={() =>
                  void onCall("climate", "set_temperature", {
                    entity_id,
                    target_temp_low: clamp(low! + step),
                    target_temp_high: high!,
                  })
                }
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <div className="setpoint">
            <span>Cool to</span>
            <div className="stepper">
              <button
                type="button"
                aria-label="Lower cool"
                onClick={() =>
                  void onCall("climate", "set_temperature", {
                    entity_id,
                    target_temp_low: low!,
                    target_temp_high: clamp(high! - step),
                  })
                }
              >
                <Minus size={18} />
              </button>
              <strong>{Math.round(high!)}°</strong>
              <button
                type="button"
                aria-label="Raise cool"
                onClick={() =>
                  void onCall("climate", "set_temperature", {
                    entity_id,
                    target_temp_low: low!,
                    target_temp_high: clamp(high! + step),
                  })
                }
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="setpoint wide">
          <span>Set to</span>
          <div className="stepper big">
            <button
              type="button"
              aria-label="Lower"
              onClick={() =>
                void onCall("climate", "set_temperature", {
                  entity_id,
                  temperature: clamp((single ?? current ?? min) - step),
                })
              }
            >
              <Minus size={20} />
            </button>
            <strong>{single != null ? Math.round(single) : "—"}°</strong>
            <button
              type="button"
              aria-label="Raise"
              onClick={() =>
                void onCall("climate", "set_temperature", {
                  entity_id,
                  temperature: clamp((single ?? current ?? min) + step),
                })
              }
            >
              <Plus size={20} />
            </button>
          </div>
        </div>
      )}

      {modes.length ? (
        <div className="mode-group">
          {modes.map((mode) => (
            <button
              type="button"
              key={mode}
              className={`mode-btn ${state.state === mode ? "active" : ""}`}
              onClick={() => void onCall("climate", "set_hvac_mode", { entity_id, hvac_mode: mode })}
            >
              {HVAC_LABEL[mode] ?? titleCase(mode)}
            </button>
          ))}
        </div>
      ) : null}

      {fanModes.length ? (
        <div className="seg-row">
          <span>Fan</span>
          <div className="seg">
            {fanModes.map((mode) => (
              <button
                type="button"
                key={mode}
                className={fanMode === mode ? "active" : ""}
                onClick={() => void onCall("climate", "set_fan_mode", { entity_id, fan_mode: mode })}
              >
                {titleCase(mode)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {presets.length ? (
        <div className="seg-row">
          <span>Preset</span>
          <div className="seg">
            {presets.map((mode) => (
              <button
                type="button"
                key={mode}
                className={preset === mode ? "active" : ""}
                onClick={() =>
                  void onCall("climate", "set_preset_mode", { entity_id, preset_mode: mode })
                }
              >
                {titleCase(mode)}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {swingModes.length ? (
        <div className="seg-row">
          <span>Swing</span>
          <div className="seg">
            {swingModes.map((mode) => (
              <button
                type="button"
                key={mode}
                className={swing === mode ? "active" : ""}
                onClick={() =>
                  void onCall("climate", "set_swing_mode", { entity_id, swing_mode: mode })
                }
              >
                {titleCase(mode)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GenericToggle({ state, onCall }: { state: HaState; onCall: CallService }) {
  const domain = domainOf(state);
  const on = isOn(state);
  if (domain === "lock") {
    return (
      <button
        type="button"
        className={`big-toggle ${on ? "on" : ""}`}
        onClick={() => void onCall("lock", on ? "lock" : "unlock", { entity_id: state.entity_id })}
      >
        {on ? <Unlock size={20} /> : <Lock size={20} />}
        <span>{on ? "Unlocked" : "Locked"}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`big-toggle ${on ? "on" : ""}`}
      onClick={() => void onCall(domain, "toggle", { entity_id: state.entity_id })}
    >
      <Power size={20} />
      <span>{on ? "On" : "Off"}</span>
    </button>
  );
}

export function EntitySheet({
  state,
  onCall,
  onBack,
  onClose,
  baseUrl,
}: {
  state: HaState;
  onCall: CallService;
  onBack?: () => void;
  onClose: () => void;
  baseUrl?: string;
}) {
  const domain = domainOf(state);
  return (
    <div className="control-sheet" onPointerDown={(event) => event.stopPropagation()}>
      <div className="sheet-header">
        {onBack ? (
          <button type="button" aria-label="Back" onClick={onBack}>
            <ChevronLeft size={20} />
          </button>
        ) : null}
        <h2>{friendlyStateName(state)}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {domain === "light" ? (
        <LightControls state={state} onCall={onCall} />
      ) : domain === "fan" ? (
        <FanControls state={state} onCall={onCall} />
      ) : domain === "cover" ? (
        <CoverControls state={state} onCall={onCall} />
      ) : domain === "media_player" ? (
        <MediaControls state={state} onCall={onCall} baseUrl={baseUrl} />
      ) : domain === "climate" ? (
        <ClimateControls state={state} onCall={onCall} />
      ) : (
        <GenericToggle state={state} onCall={onCall} />
      )}
    </div>
  );
}

const ROOM_ENTITY_DOMAINS = [
  "light",
  "switch",
  "fan",
  "cover",
  "lock",
  "media_player",
  "climate",
];

const DOMAIN_LABELS: Record<string, string> = {
  light: "Lights",
  switch: "Switches",
  fan: "Fans",
  cover: "Shades",
  lock: "Locks",
  media_player: "Media",
  climate: "Climate",
};

function mediaArtUrl(state: HaState, baseUrl?: string): string | null {
  const picture = state.attributes?.entity_picture;
  if (typeof picture !== "string" || !picture) return null;
  return picture.startsWith("http") ? picture : `${baseUrl ?? ""}${picture}`;
}

function mediaSubtitle(state: HaState): string {
  const title = state.attributes?.media_title;
  const appName = state.attributes?.app_name;
  if (typeof title === "string" && title) return title;
  if (typeof appName === "string" && appName) return appName;
  return friendlyStateName(state) === state.state ? "Idle" : state.state;
}

// On-card volume slider: optimistic + debounced commit so dragging stays smooth
// on the touchscreen and a poll doesn't yank the thumb mid-drag.
function CardVolume({ player, onCall }: { player: HaState; onCall: CallService }) {
  const level = numericAttribute(player, "volume_level");
  const [value, setValue] = useState(level == null ? 0 : Math.round(level * 100));
  const touchedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!touchedRef.current && level != null) setValue(Math.round(level * 100));
  }, [level]);

  if (level == null) return null;

  const commit = (pct: number) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      touchedRef.current = false;
      void onCall("media_player", "volume_set", {
        entity_id: player.entity_id,
        volume_level: pct / 100,
      });
    }, 240);
  };

  return (
    <label
      className="media-volume"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <Volume2 size={15} />
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        style={{ ["--vol" as string]: value }}
        aria-label={`Volume for ${friendlyStateName(player)}`}
        onChange={(event) => {
          touchedRef.current = true;
          const next = Number(event.target.value);
          setValue(next);
          commit(next);
        }}
      />
      <span>{value}%</span>
    </label>
  );
}

// The full "big" media card (album art + now-playing + volume + transport) used
// on the dashboard and inside rooms. Tapping it opens the full media sheet.
export function MediaCard({
  player,
  onCall,
  baseUrl,
  onOpen,
}: {
  player: HaState;
  onCall: CallService;
  baseUrl?: string;
  onOpen: () => void;
}) {
  const playing = player.state === "playing";
  const art = mediaArtUrl(player, baseUrl);
  return (
    <article
      className={`media-card ${playing ? "is-playing" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
    >
      <div className="media-card-top">
        {art ? (
          <img
            className="media-thumb"
            src={art}
            alt=""
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <div className="media-thumb placeholder">
            <Music size={20} />
          </div>
        )}
        <div className="media-meta">
          <strong>{friendlyStateName(player)}</strong>
          <span>{mediaSubtitle(player)}</span>
        </div>
      </div>
      <CardVolume player={player} onCall={onCall} />
      <div className="media-card-controls">
        <button
          type="button"
          aria-label="Previous"
          onClick={(event) => {
            event.stopPropagation();
            void onCall("media_player", "media_previous_track", { entity_id: player.entity_id });
          }}
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          aria-label={`Toggle ${friendlyStateName(player)}`}
          className="media-play"
          onClick={(event) => {
            event.stopPropagation();
            void onCall("media_player", "media_play_pause", { entity_id: player.entity_id });
          }}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          type="button"
          aria-label="Next"
          onClick={(event) => {
            event.stopPropagation();
            void onCall("media_player", "media_next_track", { entity_id: player.entity_id });
          }}
        >
          <SkipForward size={16} />
        </button>
      </div>
    </article>
  );
}

function tileIcon(domain: string, on: boolean) {
  switch (domain) {
    case "light":
      return Lightbulb;
    case "switch":
      return Power;
    case "fan":
      return Fan;
    case "cover":
      return on ? DoorOpen : DoorClosed;
    case "lock":
      return on ? Unlock : Lock;
    case "climate":
      return Thermometer;
    case "media_player":
      return Music;
    default:
      return Power;
  }
}

function tileSubtitle(state: HaState, domain: string, on: boolean): string {
  if (domain === "light") {
    const brightness = numericAttribute(state, "brightness");
    const pct = brightness != null ? Math.round((brightness / 255) * 100) : on ? 100 : 0;
    return on ? `${pct}%` : "Off";
  }
  if (domain === "fan") {
    const pct = numericAttribute(state, "percentage");
    return on ? (pct != null ? `${Math.round(pct)}%` : "On") : "Off";
  }
  if (domain === "climate") {
    const temp = numericAttribute(state, "temperature");
    return temp != null ? `${Math.round(temp)}°` : titleCase(state.state);
  }
  return titleCase(state.state);
}

// A room tile whose layout adapts to the entity's domain — media players get
// album art + a play/pause control, everything else gets the right icon + state.
function RoomTile({
  state,
  onSelect,
  onCall,
  baseUrl,
}: {
  state: HaState;
  onSelect: () => void;
  onCall: CallService;
  baseUrl?: string;
}) {
  const domain = domainOf(state);
  const on = isOn(state);

  if (domain === "media_player") {
    // Rooms get the same big, glanceable media card as the dashboard.
    return <MediaCard player={state} onCall={onCall} baseUrl={baseUrl} onOpen={onSelect} />;
  }

  const Icon = tileIcon(domain, on);
  const spinning = domain === "fan" && on;
  return (
    <button type="button" className={`room-tile ${on ? "on" : ""}`} onClick={onSelect}>
      <Icon size={20} className={spinning ? "fan-spin" : ""} />
      <strong>{friendlyStateName(state)}</strong>
      <small>{tileSubtitle(state, domain, on)}</small>
    </button>
  );
}

export function RoomView({
  label,
  states,
  scenes,
  onCall,
  onBack,
  baseUrl,
  motion,
}: {
  label: string;
  states: HaState[];
  scenes: HaState[];
  onCall: CallService;
  onBack: () => void;
  baseUrl?: string;
  motion?: boolean;
}) {
  const [selected, setSelected] = useState<HaState | null>(null);
  const [closingSel, setClosingSel] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const closeSelected = () => {
    setClosingSel(true);
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setSelected(null);
      setClosingSel(false);
    }, 190);
  };

  // Keep the selected entity's data fresh as states update.
  const liveSelected = useMemo(
    () => (selected ? states.find((s) => s.entity_id === selected.entity_id) ?? selected : null),
    [selected, states],
  );

  const grouped = useMemo(
    () =>
      ROOM_ENTITY_DOMAINS.map((domain) => ({
        domain,
        items: states
          .filter((state) => domainOf(state) === domain)
          .sort((a, b) => friendlyStateName(a).localeCompare(friendlyStateName(b))),
      })).filter((group) => group.items.length > 0),
    [states],
  );

  return (
    <div className="room-view">
      <header className="room-view-header">
        <button type="button" aria-label="Back" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <h1>{label}</h1>
        {motion ? (
          <span className="room-motion-pill">
            <Radar size={14} /> Active now
          </span>
        ) : null}
      </header>

      <div className="room-view-body">
        {grouped.map((group) => (
          <section className="room-view-group" key={group.domain}>
            <div className="sheet-group-label">{DOMAIN_LABELS[group.domain] ?? group.domain}</div>
            <div className="room-view-grid">
              {group.items.map((state) => (
                <RoomTile
                  key={state.entity_id}
                  state={state}
                  baseUrl={baseUrl}
                  onCall={onCall}
                  onSelect={() => setSelected(state)}
                />
              ))}
            </div>
          </section>
        ))}

        {scenes.length > 0 ? (
          <section className="room-view-group">
            <div className="sheet-group-label">
              <Sparkles size={15} /> Scenes
            </div>
            <div className="scene-row">
              {scenes.map((scene) => (
                <button
                  type="button"
                  key={scene.entity_id}
                  onClick={() => void onCall("scene", "turn_on", { entity_id: scene.entity_id })}
                >
                  {friendlyStateName(scene)}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {liveSelected ? (
        <div
          className={`sheet-backdrop ${closingSel ? "closing" : ""}`}
          onPointerDown={closeSelected}
        >
          <EntitySheet
            state={liveSelected}
            onCall={onCall}
            onClose={closeSelected}
            baseUrl={baseUrl}
          />
        </div>
      ) : null}
    </div>
  );
}
