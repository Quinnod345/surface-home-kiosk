export type DashboardMode = "idle" | "dashboard";

export type PersonProfile = {
  id: string;
  displayName: string;
  dashboardUrl?: string;
  dashboardPath?: string;
  referenceImageUrls?: string[];
  faceDescriptors?: number[][];
  greeting?: string;
};

export type KioskConfig = {
  deviceName: string;
  debug: boolean;
  homeAssistant: {
    baseUrl: string;
    dashboardUrl: string;
    accessToken?: string;
    eventPrefix: string;
    occupancyEntityId?: string;
    activePersonEntityId?: string;
  };
  slideshow: {
    photos: string[];
    intervalMs: number;
  };
  camera: {
    enabled: boolean;
    width: number;
    height: number;
    motionSensitivity: number;
    motionHoldMs: number;
    closeFaceRatio: number;
  };
  faceRecognition: {
    enabled: boolean;
    modelUrl: string;
    matchThreshold: number;
    scanIntervalMs: number;
    openDashboardOnRecognition: boolean;
    greetCooldownMs: number;
  };
  nativeBridge: {
    enabled: boolean;
    url: string;
    preferredSourceKind: "Infrared" | "Color";
  };
  behavior: {
    dashboardIdleTimeoutMs: number;
    returnToPhotosOnIdle: boolean;
    openDashboardOnCloseFace: boolean;
    openDashboardOnTap: boolean;
  };
  people: PersonProfile[];
  runtime?: {
    configPath?: string | null;
    userConfigPath?: string;
  };
};

export const defaultConfig: KioskConfig = {
  deviceName: "surface-pro-3-kiosk",
  debug: false,
  homeAssistant: {
    baseUrl: "http://homeassistant.local:8123",
    dashboardUrl: "http://homeassistant.local:8123/lovelace/default_view?kiosk",
    eventPrefix: "surface_kiosk",
  },
  slideshow: {
    photos: ["/photos/README.md"],
    intervalMs: 12000,
  },
  camera: {
    enabled: true,
    width: 640,
    height: 480,
    motionSensitivity: 0.075,
    motionHoldMs: 9000,
    closeFaceRatio: 0.34,
  },
  faceRecognition: {
    enabled: false,
    modelUrl: "/models",
    matchThreshold: 0.5,
    scanIntervalMs: 1400,
    openDashboardOnRecognition: true,
    greetCooldownMs: 180000,
  },
  nativeBridge: {
    enabled: false,
    url: "ws://127.0.0.1:8765/events",
    preferredSourceKind: "Infrared",
  },
  behavior: {
    dashboardIdleTimeoutMs: 90000,
    returnToPhotosOnIdle: true,
    openDashboardOnCloseFace: true,
    openDashboardOnTap: true,
  },
  people: [],
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isObject(override)) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    if (isObject(current) && isObject(value)) {
      merged[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  }

  return merged as T;
}

export function normalizeConfig(config: unknown): KioskConfig {
  return deepMerge(defaultConfig as unknown as Record<string, unknown>, config) as KioskConfig;
}

export async function loadKioskConfig(): Promise<KioskConfig> {
  if (window.surfaceKiosk) {
    return normalizeConfig(await window.surfaceKiosk.readConfig());
  }

  try {
    const response = await fetch("/kiosk-config.json", { cache: "no-store" });
    if (response.ok) {
      return normalizeConfig(await response.json());
    }
  } catch (error) {
    console.warn("Could not load kiosk-config.json", error);
  }

  return defaultConfig;
}

export function dashboardUrlFor(config: KioskConfig, personId?: string | null) {
  const person = config.people.find((candidate) => candidate.id === personId);
  if (person?.dashboardUrl) return person.dashboardUrl;

  if (person?.dashboardPath) {
    return new URL(person.dashboardPath, config.homeAssistant.baseUrl).toString();
  }

  return config.homeAssistant.dashboardUrl;
}
