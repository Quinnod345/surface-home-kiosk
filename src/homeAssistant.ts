import type { DashboardMode, KioskConfig, PersonProfile } from "./config";

export type HomeAssistantResult =
  | { ok: true; details?: unknown }
  | { ok: false; error: string };

async function browserPost(
  config: KioskConfig,
  pathname: string,
  payload: unknown,
): Promise<unknown> {
  const token = config.homeAssistant.accessToken;
  if (!token) throw new Error("Home Assistant accessToken is not configured.");

  const baseUrl = config.homeAssistant.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function fireKioskEvent(
  config: KioskConfig,
  name: string,
  payload: Record<string, unknown>,
): Promise<HomeAssistantResult> {
  const eventType = `${config.homeAssistant.eventPrefix}_${name}`;
  try {
    if (window.surfaceKiosk) {
      return {
        ok: true,
        details: await window.surfaceKiosk.fireHomeAssistantEvent(eventType, payload),
      };
    }

    return {
      ok: true,
      details: await browserPost(config, `/api/events/${eventType}`, payload),
    };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

export async function setHomeAssistantText(
  config: KioskConfig,
  entityId: string | undefined,
  value: string,
): Promise<HomeAssistantResult> {
  if (!entityId) return { ok: true };

  const payload = { entity_id: entityId, value };
  try {
    if (window.surfaceKiosk) {
      return {
        ok: true,
        details: await window.surfaceKiosk.callHomeAssistantService(
          "input_text",
          "set_value",
          payload,
        ),
      };
    }

    return {
      ok: true,
      details: await browserPost(config, "/api/services/input_text/set_value", payload),
    };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

export function kioskPayload(
  config: KioskConfig,
  mode: DashboardMode,
  person?: PersonProfile | null,
) {
  return {
    device: config.deviceName,
    mode,
    person_id: person?.id ?? null,
    person_name: person?.displayName ?? null,
    at: new Date().toISOString(),
  };
}
