import { memo } from "react";
import type { HaState } from "./homeAssistant";
import { defaultConfig } from "./config";
import { EntitySheet, RoomView } from "./EntityControls";
import { HomeCenterDashboard } from "./HomeCenterDashboard";
import { CalendarOverlay } from "./CalendarOverlay";
import { CalendarView } from "./CalendarView";
import { GroceryView } from "./GroceryView";
import { SettingsView } from "./SettingsView";

const noop = () => {};
const noopAsync = async () => {};

// Representative states that exercise every control path (sliders, steppers, mode
// buttons, swatches, transport, effects).
const WARM_STATES: HaState[] = [
  {
    entity_id: "light.warm",
    state: "on",
    attributes: {
      brightness: 150,
      supported_color_modes: ["color_temp", "rgb"],
      min_color_temp_kelvin: 2200,
      max_color_temp_kelvin: 6500,
      color_temp_kelvin: 3200,
      effect_list: ["Solid", "Aurora"],
      effect: "Solid",
    },
  },
  {
    entity_id: "climate.warm",
    state: "heat_cool",
    attributes: {
      current_temperature: 72,
      target_temp_low: 65,
      target_temp_high: 72,
      hvac_modes: ["off", "heat", "cool", "heat_cool"],
      fan_modes: ["on", "auto"],
      preset_modes: ["none", "away", "hold"],
      fan_mode: "auto",
      preset_mode: "none",
      min_temp: 40,
      max_temp: 99,
    },
  },
  {
    entity_id: "media_player.warm",
    state: "playing",
    attributes: { media_title: "Warm", media_artist: "Up", volume_level: 0.5 },
  },
  { entity_id: "fan.warm", state: "on", attributes: { percentage: 50, percentage_step: 25 } },
  { entity_id: "cover.warm", state: "open", attributes: {} },
  { entity_id: "lock.warm", state: "locked", attributes: {} },
];

// Entities that populate the dashboard cards (rooms/climate/media/fan/camera).
const DASH_STATES: HaState[] = [
  { entity_id: "light.garage_warm", state: "on", attributes: { friendly_name: "Garage Light" } },
  { entity_id: "switch.theater_warm", state: "off", attributes: { friendly_name: "Theater Switch" } },
  ...WARM_STATES,
  {
    entity_id: "media_player.warm_dash",
    state: "playing",
    attributes: { friendly_name: "Warm Player", media_title: "Warm Up", volume_level: 0.5 },
  },
  { entity_id: "camera.warm", state: "idle", attributes: { friendly_name: "Warm Cam" } },
];

function ControlsWarmupComponent() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        left: -10000,
        top: 0,
        width: 980,
        height: 700,
        opacity: 0.0001,
        pointerEvents: "none",
        zIndex: -1,
      }}
    >
      <HomeCenterDashboard
        config={defaultConfig}
        states={DASH_STATES}
        status="ok"
        error={null}
        activePerson={null}
        onCallService={noopAsync}
        onOpenCamera={noop}
        onRefresh={noop}
        onSaveConfig={noop}
      />
      {WARM_STATES.map((state) => (
        <EntitySheet key={state.entity_id} state={state} onCall={noop} onClose={noop} />
      ))}
      <RoomView label="Warm" states={WARM_STATES} scenes={[]} onCall={noop} onBack={noop} />
      <CalendarView config={defaultConfig} states={DASH_STATES} onSaveConfig={noop} />
      <GroceryView config={defaultConfig} onCallService={noopAsync} />
      <SettingsView config={defaultConfig} states={DASH_STATES} onClose={noop} onSaved={noop} />
      <CalendarOverlay
        events={[
          {
            calendarId: "calendar.warm",
            color: "#f7b955",
            summary: "Warm",
            description: "",
            location: "",
            start: new Date().toISOString(),
            end: null,
            allDay: false,
            uid: "warm",
            recurrenceId: null,
            startDate: new Date(),
          },
        ]}
        onInteract={noop}
      />
    </div>
  );
}

// No props → renders exactly once and never re-reconciles.
export const ControlsWarmup = memo(ControlsWarmupComponent);
