import type { DashboardMode, KioskConfig, PersonProfile } from "./config";

export type HomeAssistantResult =
  | { ok: true; details?: unknown }
  | { ok: false; error: string };

export type HaAttributes = Record<string, unknown>;

export type HaState = {
  entity_id: string;
  state: string;
  attributes?: HaAttributes;
  last_changed?: string;
  last_updated?: string;
  context?: unknown;
};

export type ServiceCallResult =
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

async function browserGet(config: KioskConfig, pathname: string): Promise<unknown> {
  const token = config.homeAssistant.accessToken;
  if (!token) throw new Error("Home Assistant accessToken is not configured.");

  const baseUrl = config.homeAssistant.baseUrl.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function normalizeHaStates(value: unknown): HaState[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (candidate): candidate is HaState =>
        typeof candidate === "object" &&
        candidate !== null &&
        typeof (candidate as HaState).entity_id === "string" &&
        typeof (candidate as HaState).state === "string",
    )
    .map((state) => ({
      ...state,
      attributes:
        typeof state.attributes === "object" && state.attributes !== null
          ? state.attributes
          : {},
    }));
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

export async function callHomeAssistantService(
  config: KioskConfig,
  domain: string,
  service: string,
  payload: unknown,
): Promise<ServiceCallResult> {
  try {
    if (window.surfaceKiosk) {
      return {
        ok: true,
        details: await window.surfaceKiosk.callHomeAssistantService(
          domain,
          service,
          payload,
        ),
      };
    }

    return {
      ok: true,
      details: await browserPost(
        config,
        `/api/services/${domain}/${service}`,
        payload,
      ),
    };
  } catch (error) {
    return { ok: false, error: String(error instanceof Error ? error.message : error) };
  }
}

export async function getHomeAssistantStates(config: KioskConfig): Promise<HaState[]> {
  if (window.surfaceKiosk) {
    return normalizeHaStates(await window.surfaceKiosk.getHomeAssistantStates());
  }

  return normalizeHaStates(await browserGet(config, "/api/states"));
}

export async function getHomeAssistantCameraSnapshot(
  config: KioskConfig,
  entityId: string,
): Promise<string> {
  if (window.surfaceKiosk) {
    const snapshot = await window.surfaceKiosk.getHomeAssistantCameraSnapshot(entityId);
    return snapshot.dataUrl;
  }

  const baseUrl = config.homeAssistant.baseUrl.replace(/\/$/, "");
  return `${baseUrl}/api/camera_proxy/${encodeURIComponent(entityId)}`;
}

export function friendlyStateName(state: HaState) {
  const friendlyName = state.attributes?.friendly_name;
  if (typeof friendlyName === "string" && friendlyName.trim()) return friendlyName;

  return state.entity_id
    .split(".")
    .pop()
    ?.replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? state.entity_id;
}

export function numericAttribute(state: HaState, key: string) {
  const value = state.attributes?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
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
