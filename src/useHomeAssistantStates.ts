import { useCallback, useEffect, useState } from "react";
import type { KioskConfig } from "./config";
import { getHomeAssistantStates, type HaState } from "./homeAssistant";

const RELEVANT_DOMAINS = new Set([
  "light",
  "switch",
  "binary_sensor",
  "sensor",
  "climate",
  "fan",
  "media_player",
  "camera",
  "scene",
  "cover",
  "lock",
  "button",
  "input_boolean",
  "group",
  "humidifier",
  "calendar",
  "weather",
  "todo",
]);

function domainOf(entityId: string) {
  return entityId.split(".")[0] ?? "";
}

type HomeAssistantStatesResult = {
  states: HaState[];
  status: "idle" | "loading" | "ok" | "error";
  error: string | null;
  refresh: () => Promise<void>;
};

export function useHomeAssistantStates(
  config: KioskConfig,
  enabled: boolean,
  intervalMs = 5000,
): HomeAssistantStatesResult {
  const [states, setStates] = useState<HaState[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    enabled ? "loading" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Stable across renders so consumers (e.g. a memoized dashboard) are not
  // re-rendered just because this hook produced a new function identity.
  const refresh = useCallback(async () => {
    if (!enabled) return;

    setStatus((current) => (current === "ok" ? current : "loading"));
    try {
      const nextStates = await getHomeAssistantStates(config);
      // Keep only domains the kiosk renders/controls so the dashboard isn't
      // re-filtering hundreds of device_tracker/update/etc. entities each poll.
      setStates(nextStates.filter((state) => RELEVANT_DOMAINS.has(domainOf(state.entity_id))));
      setStatus("ok");
      setError(null);
    } catch (refreshError) {
      setStatus("error");
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Could not read Home Assistant states.",
      );
    }
    // getHomeAssistantStates only reads these config fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.homeAssistant.baseUrl, config.homeAssistant.accessToken, enabled]);

  useEffect(() => {
    if (!enabled) {
      setStates([]);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      await refresh();
    }

    void tick();
    const interval = window.setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [enabled, intervalMs, refresh]);

  return { states, status, error, refresh };
}
