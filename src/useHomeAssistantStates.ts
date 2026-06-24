import { useEffect, useState } from "react";
import type { KioskConfig } from "./config";
import { getHomeAssistantStates, type HaState } from "./homeAssistant";

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

  async function refresh() {
    if (!enabled) return;

    setStatus((current) => (current === "ok" ? current : "loading"));
    try {
      const nextStates = await getHomeAssistantStates(config);
      setStates(nextStates);
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
  }

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
  }, [
    config.homeAssistant.baseUrl,
    config.homeAssistant.accessToken,
    enabled,
    intervalMs,
  ]);

  return { states, status, error, refresh };
}
