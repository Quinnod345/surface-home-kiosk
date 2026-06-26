import { app, BrowserWindow, ipcMain, net, protocol, session } from "electron";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import netModule from "node:net";
import path from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

type HomeAssistantConfig = {
  baseUrl?: string;
  accessToken?: string;
  dashboardUrl?: string;
  eventPrefix?: string;
  allowSelfSignedCertificate?: boolean;
};

type KioskConfig = {
  homeAssistant?: HomeAssistantConfig;
  [key: string]: unknown;
};

type EnrollmentStore = {
  version: 1;
  people: unknown[];
};

type KioskStateDb = {
  version: 1;
  updatedAt: string;
  config?: KioskConfig;
  enrollments?: EnrollmentStore;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;
let loadedConfig: KioskConfig = {};
const trustedHomeAssistantHosts = new Set<string>();

app.setName("Surface Home Kiosk");
app.setPath("userData", path.join(app.getPath("appData"), "SurfaceHomeKiosk"));
app.commandLine.appendSwitch("remote-debugging-port", "9222");
// The Surface Pro 4's Intel HD 520 can drop the GPU command buffer under load
// (tfjs WebGL + compositing). Without these, one GPU hiccup permanently blocks
// WebGL for the page (face recognition silently dies) and a few crashes drop the
// whole app to slow software rendering.
app.disableDomainBlockingFor3DAPIs();
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "kiosk",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function appRoot() {
  return path.resolve(__dirname, "..", "..");
}

function devServerUrl() {
  return process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
}

function preloadPath() {
  return path.join(appRoot(), "electron", "preload.cjs");
}

function userConfigPath() {
  return path.join(app.getPath("userData"), "kiosk-config.json");
}

function stateDbPath() {
  return path.join(app.getPath("userData"), "kiosk-state.json");
}

function legacyUserConfigCandidates() {
  const appData = app.getPath("appData");
  return [
    userConfigPath(),
    path.join(appData, "surface-home-kiosk", "kiosk-config.json"),
    path.join(appData, "Electron", "kiosk-config.json"),
  ];
}

function configCandidates() {
  const root = appRoot();
  return [
    ...legacyUserConfigCandidates(),
    path.join(root, "public", "kiosk-config.local.json"),
    path.join(root, "public", "kiosk-config.json"),
    path.join(root, "dist", "kiosk-config.json"),
    path.join(root, "public", "kiosk-config.example.json"),
  ];
}

async function readJsonIfPresent(filePath: string) {
  try {
    const text = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
    return JSON.parse(text) as KioskConfig;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    console.warn(`Could not read config at ${filePath}:`, error);
    return undefined;
  }
}

async function readStateDb() {
  try {
    const text = (await fs.readFile(stateDbPath(), "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(text) as Partial<KioskStateDb>;
    if (parsed.version !== 1) return undefined;
    return parsed as KioskStateDb;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    console.warn(`Could not read local kiosk state at ${stateDbPath()}:`, error);
    return undefined;
  }
}

async function writeStateDb(patch: Partial<KioskStateDb>) {
  const current = await readStateDb();
  const next: KioskStateDb = {
    version: 1,
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(stateDbPath()), { recursive: true });
  await fs.writeFile(stateDbPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function withoutRuntime(config: KioskConfig) {
  const { runtime: _runtime, ...rest } = config;
  return rest;
}

function withRuntime(config: KioskConfig, configPath: string | null) {
  return {
    ...config,
    runtime: {
      ...(typeof config.runtime === "object" ? config.runtime : {}),
      configPath,
      statePath: stateDbPath(),
      userConfigPath: userConfigPath(),
    },
  };
}

async function readConfig() {
  const state = await readStateDb();
  if (state?.config) {
    loadedConfig = state.config;
    return withRuntime(state.config, stateDbPath());
  }

  for (const candidate of configCandidates()) {
    const config = await readJsonIfPresent(candidate);
    if (config) {
      loadedConfig = config;
      return withRuntime(config, candidate);
    }
  }

  loadedConfig = {};
  return withRuntime({}, null);
}

async function writeConfig(_event: unknown, config: KioskConfig) {
  const nextConfig = withoutRuntime(config);
  await fs.mkdir(path.dirname(userConfigPath()), { recursive: true });
  await fs.writeFile(userConfigPath(), JSON.stringify(nextConfig, null, 2), "utf8");
  await writeStateDb({ config: nextConfig });
  loadedConfig = nextConfig;
  return withRuntime(nextConfig, stateDbPath());
}

function emptyEnrollmentStore(): EnrollmentStore {
  return { version: 1, people: [] };
}

function normalizeEnrollmentStore(store: unknown): EnrollmentStore {
  if (
    typeof store === "object" &&
    store !== null &&
    (store as Partial<EnrollmentStore>).version === 1 &&
    Array.isArray((store as Partial<EnrollmentStore>).people)
  ) {
    return {
      version: 1,
      people: (store as Partial<EnrollmentStore>).people ?? [],
    };
  }

  return emptyEnrollmentStore();
}

async function readEnrollments() {
  const state = await readStateDb();
  return normalizeEnrollmentStore(state?.enrollments);
}

async function writeEnrollments(_event: unknown, store: EnrollmentStore) {
  const nextStore = normalizeEnrollmentStore(store);
  await writeStateDb({ enrollments: nextStore });
  return nextStore;
}

async function checkModels() {
  const modelsDir = path.join(appRoot(), "dist", "models");
  const required = [
    "tiny_face_detector_model-weights_manifest.json",
    "tiny_face_detector_model.bin",
    "face_landmark_68_model-weights_manifest.json",
    "face_landmark_68_model.bin",
    "face_recognition_model-weights_manifest.json",
    "face_recognition_model.bin",
  ];
  const files = await Promise.all(
    required.map(async (name) => {
      const filePath = path.join(modelsDir, name);
      try {
        const stats = await fs.stat(filePath);
        return { name, exists: true, size: stats.size };
      } catch {
        return { name, exists: false, size: 0 };
      }
    }),
  );

  return {
    modelsDir,
    ok: files.every((file) => file.exists && file.size > 0),
    files,
  };
}

function haConfig() {
  const homeAssistant = loadedConfig.homeAssistant ?? {};
  const baseUrl = normalizeHomeAssistantUrl(homeAssistant.baseUrl);
  const accessToken = homeAssistant.accessToken;

  if (!baseUrl || !accessToken) {
    throw new Error("Home Assistant baseUrl/accessToken is not configured.");
  }

  rememberHomeAssistantCertificateHost(loadedConfig);
  return { baseUrl, accessToken };
}

function haConfigFrom(config: KioskConfig) {
  const homeAssistant = config.homeAssistant ?? {};
  const baseUrl = normalizeHomeAssistantUrl(homeAssistant.baseUrl);
  const accessToken = homeAssistant.accessToken;

  if (!baseUrl || !accessToken) {
    throw new Error("Home Assistant URL/token is not configured.");
  }

  rememberHomeAssistantCertificateHost(config);
  return { baseUrl, accessToken };
}

function normalizeHomeAssistantUrl(value?: string) {
  const trimmed = value?.trim().replace(/\/$/, "");
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function homeAssistantFetchError(baseUrl: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Could not reach Home Assistant at ${baseUrl}. ` +
      `Use the Home Assistant IP address if homeassistant.local does not resolve on Windows. ` +
      `Details: ${message}`,
  );
}

function configuredHomeAssistantOrigins(config: KioskConfig = loadedConfig) {
  const homeAssistant = config.homeAssistant ?? {};
  const origins = new Set<string>();
  const baseUrl = normalizeHomeAssistantUrl(homeAssistant.baseUrl);

  for (const value of [baseUrl, homeAssistant.dashboardUrl]) {
    if (!value) continue;

    try {
      origins.add(new URL(value, baseUrl).origin);
    } catch {
      // Invalid setup values are reported through the setup/test UI.
    }
  }

  return origins;
}

function configuredHomeAssistantHosts(config: KioskConfig = loadedConfig) {
  const homeAssistant = config.homeAssistant ?? {};
  const hosts = new Set<string>();
  const baseUrl = normalizeHomeAssistantUrl(homeAssistant.baseUrl);

  for (const value of [baseUrl, homeAssistant.dashboardUrl]) {
    if (!value) continue;

    try {
      hosts.add(new URL(value, baseUrl).hostname.toLowerCase());
    } catch {
      // Invalid setup values are reported through the setup/test UI.
    }
  }

  return hosts;
}

function rememberHomeAssistantCertificateHost(config: KioskConfig) {
  const homeAssistant = config.homeAssistant ?? {};
  if (homeAssistant.allowSelfSignedCertificate === false) return;

  for (const host of configuredHomeAssistantHosts(config)) {
    trustedHomeAssistantHosts.add(host);
  }
}

function allowConfiguredHomeAssistantCertificates() {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const host = request.hostname.toLowerCase();
    const configuredHosts = configuredHomeAssistantHosts();

    if (configuredHosts.has(host) || trustedHomeAssistantHosts.has(host)) {
      callback(0);
      return;
    }

    callback(-3);
  });
}

function deleteHeader(headers: Record<string, string[]> | undefined, headerName: string) {
  if (!headers) return;
  const match = Object.keys(headers).find(
    (candidate) => candidate.toLowerCase() === headerName.toLowerCase(),
  );
  if (match) delete headers[match];
}

function removeFrameAncestors(policy: string) {
  return policy
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^frame-ancestors(?:\s|$)/i.test(directive))
    .join("; ");
}

function relaxHomeAssistantFrameHeaders() {
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const headers = details.responseHeaders;
      if (!headers) {
        callback({ responseHeaders: headers });
        return;
      }

      let requestOrigin: string;
      try {
        requestOrigin = new URL(details.url).origin;
      } catch {
        callback({ responseHeaders: headers });
        return;
      }

      if (!configuredHomeAssistantOrigins().has(requestOrigin)) {
        callback({ responseHeaders: headers });
        return;
      }

      const nextHeaders: Record<string, string[]> = { ...headers };
      deleteHeader(nextHeaders, "x-frame-options");

      for (const key of Object.keys(nextHeaders)) {
        if (key.toLowerCase() !== "content-security-policy") continue;
        const policies = nextHeaders[key]
          .map(removeFrameAncestors)
          .filter((policy) => policy.length > 0);

        if (policies.length > 0) {
          nextHeaders[key] = policies;
        } else {
          delete nextHeaders[key];
        }
      }

      callback({ responseHeaders: nextHeaders });
    },
  );
}

async function getHomeAssistant(config: KioskConfig) {
  const { baseUrl, accessToken } = haConfigFrom(config);
  let response: Response;

  try {
    response = await net.fetch(`${baseUrl}/api/`, {
      signal: AbortSignal.timeout(8000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    throw homeAssistantFetchError(baseUrl, error);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : { ok: true };
}

async function postHomeAssistant(pathname: string, payload: unknown) {
  const { baseUrl, accessToken } = haConfig();
  const response = await net.fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function getHomeAssistantJson(pathname: string) {
  const { baseUrl, accessToken } = haConfig();
  let response: Response;

  try {
    response = await net.fetch(`${baseUrl}${pathname}`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch (error) {
    throw homeAssistantFetchError(baseUrl, error);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant ${response.status}: ${text}`);
  }

  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

const RELEVANT_STATE_DOMAINS = new Set([
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

// Filter to renderable domains in the main process so the IPC payload the
// renderer deserializes each poll is a few hundred entities, not ~1900.
async function getHomeAssistantStatesFiltered() {
  const all = await getHomeAssistantJson("/api/states");
  if (!Array.isArray(all)) return all;
  return all.filter((state) => {
    const entityId = typeof state?.entity_id === "string" ? state.entity_id : "";
    return RELEVANT_STATE_DOMAINS.has(entityId.split(".")[0] ?? "");
  });
}

async function getHomeAssistantCameraSnapshot(entityId: string) {
  const { baseUrl, accessToken } = haConfig();
  let response: Response;

  try {
    response = await net.fetch(
      `${baseUrl}/api/camera_proxy/${encodeURIComponent(entityId)}`,
      {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "image/*",
        },
      },
    );
  } catch (error) {
    throw homeAssistantFetchError(baseUrl, error);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Home Assistant camera ${response.status}: ${text}`);
  }

  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    entityId,
    contentType,
    dataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
    at: new Date().toISOString(),
  };
}

function haWebSocketTarget(baseUrl: string) {
  const url = new URL(baseUrl);
  const secure = url.protocol === "https:";
  const port = url.port ? Number(url.port) : secure ? 443 : 80;
  return { host: url.hostname, port, secure, path: "/api/websocket" };
}

// Minimal Home Assistant WebSocket client: connect, authenticate, run a single
// command, resolve its result, then close. Calendar event delete/update are only
// available over the WS API (no REST service), so this covers those mutations.
// Uses a raw TLS/TCP socket (no extra dependency) and tolerates the self-signed
// certificate the kiosk already trusts for REST.
async function haWebSocketCommand(command: Record<string, unknown>): Promise<unknown> {
  const { baseUrl, accessToken } = haConfig();
  const { host, port, secure, path: wsPath } = haWebSocketTarget(baseUrl);
  const CMD_ID = 1;

  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: false })
      : netModule.connect({ host, port });

    let handshaken = false;
    let settled = false;
    let buf = Buffer.alloc(0);

    const timer = setTimeout(() => finish(new Error("Home Assistant WebSocket timeout")), 12000);

    function finish(err: Error | null, value?: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value);
    }

    function sendText(text: string) {
      const payload = Buffer.from(text, "utf8");
      const len = payload.length;
      let header: Buffer;
      if (len < 126) {
        header = Buffer.from([0x81, 0x80 | len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 0x80 | 127;
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
      }
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(len);
      for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([header, mask, masked]));
    }

    function handleMessage(text: string) {
      let msg: { type?: string; id?: number; success?: boolean; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.type === "auth_required") {
        sendText(JSON.stringify({ type: "auth", access_token: accessToken }));
      } else if (msg.type === "auth_ok") {
        sendText(JSON.stringify({ id: CMD_ID, ...command }));
      } else if (msg.type === "auth_invalid") {
        finish(new Error("Home Assistant WebSocket auth rejected"));
      } else if (msg.type === "result" && msg.id === CMD_ID) {
        if (msg.success) finish(null, msg.result ?? null);
        else finish(new Error(`Home Assistant command failed: ${JSON.stringify(msg.error ?? {})}`));
      }
    }

    function parseFrames() {
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buf[1] & 0x80) !== 0;
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + len) return;
        let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
        if (masked) {
          const maskKey = buf.subarray(offset, offset + 4);
          const out = Buffer.alloc(len);
          for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i % 4];
          payload = out;
        }
        buf = buf.subarray(offset + maskLen + len);
        if (opcode === 0x8) {
          finish(new Error("Home Assistant WebSocket closed"));
          return;
        }
        if (opcode === 0x1 || opcode === 0x0) handleMessage(payload.toString("utf8"));
        // ignore ping/pong/binary frames
      }
    }

    function onReady() {
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        `GET ${wsPath} HTTP/1.1\r\n` +
          `Host: ${host}:${port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`,
      );
    }

    socket.on(secure ? "secureConnect" : "connect", onReady);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx === -1) return;
        handshaken = true;
        buf = buf.subarray(idx + 4);
      }
      parseFrames();
    });
    socket.on("error", (error: Error) => finish(error));
    socket.on("close", () => finish(new Error("Home Assistant WebSocket closed before result")));
  });
}

type TravelEstimate =
  | { ok: true; durationMin: number; distanceMiles: number; destName: string }
  | { ok: false; reason: string };

const geocodeCache = new Map<string, { lon: number; lat: number; name: string } | null>();
const travelCache = new Map<string, { at: number; value: TravelEstimate }>();
let homeOriginCache: { at: number; lon: number; lat: number } | null = null;

async function mapboxGeocode(
  query: string,
  token: string,
  proximity: { lon: number; lat: number } | null,
): Promise<{ lon: number; lat: number; name: string } | null> {
  const cacheKey = `geo:${query.trim().toLowerCase()}`;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey) ?? null;
  const prox = proximity ? `&proximity=${proximity.lon},${proximity.lat}` : "";
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${token}&limit=1&country=us${prox}`;
  const res = await net.fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null; // don't cache a transient failure
  const json = await res.json();
  const feature = Array.isArray(json?.features) ? json.features[0] : null;
  const result =
    feature && Array.isArray(feature.center)
      ? { lon: Number(feature.center[0]), lat: Number(feature.center[1]), name: feature.place_name ?? query }
      : null;
  geocodeCache.set(cacheKey, result);
  return result;
}

async function getTravelOrigin(travel: {
  mapboxToken?: string;
  originAddress?: string;
  homeZoneEntityId?: string;
}): Promise<{ lon: number; lat: number } | null> {
  if (homeOriginCache && Date.now() - homeOriginCache.at < 3_600_000) {
    return { lon: homeOriginCache.lon, lat: homeOriginCache.lat };
  }
  // Prefer a configured street address (more precise than the HA zone center).
  if (travel.originAddress && travel.mapboxToken) {
    const geo = await mapboxGeocode(travel.originAddress, travel.mapboxToken, null);
    if (geo) {
      homeOriginCache = { at: Date.now(), lon: geo.lon, lat: geo.lat };
      return { lon: geo.lon, lat: geo.lat };
    }
  }
  try {
    const zone = await getHomeAssistantJson(
      `/api/states/${encodeURIComponent(travel.homeZoneEntityId || "zone.home")}`,
    );
    const lat = Number(zone?.attributes?.latitude);
    const lon = Number(zone?.attributes?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    homeOriginCache = { at: Date.now(), lon, lat };
    return { lon, lat };
  } catch {
    return null;
  }
}

// Drive time from home to a free-text event location, via Mapbox (geocoding +
// live-traffic directions). The secret token comes from the on-device config and
// never leaves the main process. Results are cached.
async function estimateTravel(destText: string): Promise<TravelEstimate> {
  const travel = ((loadedConfig as Record<string, unknown>).travel ?? {}) as {
    provider?: string;
    mapboxToken?: string;
    originAddress?: string;
    homeZoneEntityId?: string;
  };
  if (travel.provider !== "mapbox" || !travel.mapboxToken) {
    return { ok: false, reason: "Travel time is not configured." };
  }
  if (!destText || !destText.trim()) return { ok: false, reason: "No location." };

  const key = destText.trim().toLowerCase();
  const cached = travelCache.get(key);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;

  try {
    const token = travel.mapboxToken;
    const origin = await getTravelOrigin(travel);
    if (!origin) return { ok: false, reason: "No home location." };

    const dest = await mapboxGeocode(destText, token, origin);
    if (!dest) {
      const value: TravelEstimate = { ok: false, reason: "Couldn't find that place." };
      travelCache.set(key, { at: Date.now(), value });
      return value;
    }

    const dirUrl =
      `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
      `${origin.lon},${origin.lat};${dest.lon},${dest.lat}` +
      `?access_token=${token}&overview=false`;
    const dirRes = await net.fetch(dirUrl, { signal: AbortSignal.timeout(10000) });
    if (!dirRes.ok) return { ok: false, reason: `Route failed (${dirRes.status}).` };
    const dir = await dirRes.json();
    const route = Array.isArray(dir?.routes) ? dir.routes[0] : null;
    if (!route) return { ok: false, reason: "No route found." };

    const value: TravelEstimate = {
      ok: true,
      durationMin: Math.round(Number(route.duration) / 60),
      distanceMiles: Math.round((Number(route.distance) / 1609.34) * 10) / 10,
      destName: dest.name,
    };
    travelCache.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Travel lookup failed." };
  }
}

// Pull photo URLs from an iCloud shared album link. Modern links
// (photos.icloud.com/shared/album/<token>) are CloudKit-backed: resolve the
// shortGUID anonymously to get a public-access auth token + the shared zone, then
// query CPLAssetAndMasterByAddedDate for the assets' signed download URLs. Older
// links (www.icloud.com/sharedalbum/#<token>) use the sharedstreams API.
function icloudAlbumToken(value: string): string {
  let v = value.trim();
  const hash = v.match(/#([A-Za-z0-9_-]+)/);
  if (hash) return hash[1];
  v = v.replace(/^https?:\/\//i, "").split(/[?#]/)[0];
  const segments = v.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? v;
}

async function ckJsonPost(url: string, body: unknown): Promise<unknown> {
  const res = await net.fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { "Content-Type": "application/json", Origin: "https://www.icloud.com" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`CloudKit ${res.status}`);
  return res.json();
}

type MediaItem = { type: "image" | "video"; url: string; poster?: string };

type CkResolve = {
  results?: {
    anonymousPublicAccess?: { token?: string; databasePartition?: string };
    zoneID?: { zoneName?: string; ownerRecordName?: string };
  }[];
};
type CkFieldValue = { downloadURL?: string };
type CkField = { value?: CkFieldValue | string | number };
type CkRecord = { recordType?: string; fields?: Record<string, CkField> };
type CkQuery = { records?: CkRecord[] };

async function fetchViaCloudKit(token: string): Promise<MediaItem[]> {
  const resolve = (await ckJsonPost(
    "https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production/public/records/resolve" +
      `?clientId=${crypto.randomUUID()}`,
    { shortGUIDs: [{ value: token }] },
  )) as CkResolve;
  const r = resolve.results?.[0];
  const authToken = r?.anonymousPublicAccess?.token;
  const partition = r?.anonymousPublicAccess?.databasePartition;
  const zoneName = r?.zoneID?.zoneName;
  const ownerRecordName = r?.zoneID?.ownerRecordName;
  if (!authToken || !partition || !zoneName || !ownerRecordName) return [];

  const queryUrl =
    `${partition}/database/1/com.apple.photos.cloud/production/shared/records/query` +
    `?remapEnums=true&getCurrentSyncToken=true&sharing_url_key=${encodeURIComponent(token)}` +
    `&publicAccessAuthToken=${encodeURIComponent(authToken)}` +
    `&clientBuildNumber=2622BuildBeta25&clientMasteringNumber=2622BuildBeta25&clientId=${crypto.randomUUID()}`;

  const items: MediaItem[] = [];
  const PAGE = 200;
  const MAX = 600;
  let startRank = 0;
  for (let page = 0; page < 12 && items.length < MAX; page++) {
    const data = (await ckJsonPost(queryUrl, {
      query: {
        recordType: "CPLAssetAndMasterByAddedDate",
        filterBy: [
          { fieldName: "direction", comparator: "EQUALS", fieldValue: { value: "ASCENDING", type: "STRING" } },
          { fieldName: "startRank", comparator: "EQUALS", fieldValue: { value: startRank, type: "INT64" } },
        ],
      },
      zoneID: { zoneName, ownerRecordName, zoneType: "REGULAR_CUSTOM_ZONE" },
      resultsLimit: PAGE,
    })) as CkQuery;
    const records = Array.isArray(data.records) ? data.records : [];
    const masters = records.filter((rec) => rec.recordType === "CPLMaster");
    if (masters.length === 0) break;
    for (const master of masters) {
      const f = master.fields ?? {};
      const dl = (key: string): string | undefined => {
        const v = f[key]?.value;
        return v && typeof v === "object" ? (v as CkFieldValue).downloadURL : undefined;
      };
      const fileType = String(f.resOriginalFileType?.value ?? f.itemType?.value ?? "");
      const isVideo = /mpeg|mp4|movie|video|quicktime/i.test(fileType);
      const liveVideo = dl("resOriginalVidComplRes"); // Live Photo motion component
      // Prefer JPEG derivatives (originals can be HEIC and won't render).
      const poster = dl("resJPEGFullRes") ?? dl("resJPEGMedRes");

      if (isVideo) {
        const vid = dl("resVidMedRes") ?? dl("resVidSmallRes") ?? dl("resOriginalRes");
        if (vid) items.push({ type: "video", url: vid, poster });
        else if (poster) items.push({ type: "image", url: poster });
      } else if (liveVideo) {
        items.push({ type: "video", url: liveVideo, poster: poster ?? dl("resOriginalRes") });
      } else {
        const img = dl("resJPEGFullRes") ?? dl("resJPEGMedRes") ?? dl("resOriginalRes");
        if (img) items.push({ type: "image", url: img });
      }
    }
    startRank += masters.length;
    if (records.length < PAGE) break;
  }
  return items;
}

async function fetchViaSharedStreams(token: string): Promise<MediaItem[]> {
  const post = (url: string, body: unknown) =>
    net.fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "text/plain", Origin: "https://www.icloud.com" },
      body: JSON.stringify(body ?? {}),
    });
  const webstream = (host: string) => `https://${host}/${token}/sharedstreams/webstream`;
  let host = "p01-sharedstreams.icloud.com";
  let res = await post(webstream(host), { streamCtag: null });
  if (res.status === 330) {
    const redirect = (await res.json()) as { "X-Apple-MMe-Host"?: string };
    if (redirect["X-Apple-MMe-Host"]) host = redirect["X-Apple-MMe-Host"];
    res = await post(webstream(host), { streamCtag: null });
  }
  if (!res.ok) throw new Error(`sharedstreams ${res.status}`);
  const data = (await res.json()) as {
    photos?: {
      photoGuid?: string;
      derivatives?: Record<string, { checksum?: string; width?: unknown; height?: unknown }>;
    }[];
  };
  const photos = Array.isArray(data.photos) ? data.photos : [];
  const guids: string[] = [];
  const guidChecksum = new Map<string, string>();
  for (const photo of photos) {
    if (!photo.photoGuid || !photo.derivatives) continue;
    let best: string | null = null;
    let bestArea = -1;
    for (const d of Object.values(photo.derivatives)) {
      const area = (Number(d?.width) || 0) * (Number(d?.height) || 0);
      if (d?.checksum && area >= bestArea) {
        bestArea = area;
        best = d.checksum;
      }
    }
    if (best) {
      guids.push(photo.photoGuid);
      guidChecksum.set(photo.photoGuid, best);
    }
  }
  if (guids.length === 0) return [];
  const assetRes = await post(`https://${host}/${token}/sharedstreams/webasseturls`, {
    photoGuids: guids,
  });
  if (!assetRes.ok) throw new Error(`webasseturls ${assetRes.status}`);
  const assetData = (await assetRes.json()) as {
    items?: Record<string, { url_location?: string; url_path?: string }>;
  };
  const items = assetData.items ?? {};
  const out: MediaItem[] = [];
  for (const guid of guids) {
    const item = items[guidChecksum.get(guid) ?? ""];
    if (item?.url_location && item?.url_path) {
      out.push({ type: "image", url: `https://${item.url_location}${item.url_path}` });
    }
  }
  return out;
}

async function fetchIcloudAlbumPhotos(albumUrl: string): Promise<MediaItem[]> {
  const token = icloudAlbumToken(albumUrl);
  if (!token) return [];
  // Modern CloudKit links first; fall back to the classic sharedstreams API.
  try {
    const ck = await fetchViaCloudKit(token);
    if (ck.length) return ck;
  } catch {
    // fall through
  }
  try {
    return await fetchViaSharedStreams(token);
  } catch {
    return [];
  }
}

// Native Apple Reminders via the Mac "reminders bridge" (mac-reminders-bridge on
// a Mac on the LAN). It's the only backend that can read AND add to an iCloud
// *shared* list. Config + token live on-device (state DB), used from main only.
type ReminderBridge = { url: string; token: string; list: string };

function reminderBridge(): ReminderBridge {
  const g = (loadedConfig.grocery ?? {}) as {
    bridgeUrl?: string;
    bridgeToken?: string;
    bridgeList?: string;
  };
  const url = g.bridgeUrl?.trim().replace(/\/$/, "");
  if (!url) throw new Error("Reminders bridge is not configured.");
  return { url, token: g.bridgeToken ?? "", list: g.bridgeList?.trim() || "Grocery" };
}

async function bridgeFetch(
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const { url, token } = reminderBridge();
  const res = await net.fetch(`${url}${pathname}`, {
    method: options.method ?? "GET",
    signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res.json();
}

async function setWindowsDisplayPower(enabled: boolean) {
  if (process.platform !== "win32") {
    return { ok: false, skipped: true, reason: "Display power control is Windows-only." };
  }

  const monitorPowerState = enabled ? -1 : 2;
  const script = [
    '$signature = @\'',
    '[DllImport("user32.dll")]',
    "public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);",
    "'@",
    "Add-Type -MemberDefinition $signature -Name NativeMethods -Namespace Win32",
    `[Win32.NativeMethods]::SendMessage([intptr]0xffff, 0x0112, [intptr]0xF170, [intptr]${monitorPowerState}) | Out-Null`,
  ].join("\n");

  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { timeout: 5000, windowsHide: true },
  );

  return { ok: true, enabled };
}

function distAssetPath(requestUrl: string) {
  const distRoot = path.join(appRoot(), "dist");
  const url = new URL(requestUrl);
  let requestPath =
    url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (requestPath.startsWith("app/")) {
    requestPath = requestPath.slice("app/".length);
  }
  const filePath = path.normalize(path.join(distRoot, requestPath));
  const relativePath = path.relative(distRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return filePath;
}

function registerKioskProtocol() {
  protocol.handle("kiosk", (request) => {
    const filePath = distAssetPath(request.url);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function createWindow() {
  const fullscreen = process.env.SURFACE_KIOSK === "1";
  const useDevServer =
    Boolean(process.env.VITE_DEV_SERVER_URL) ||
    (process.env.NODE_ENV !== "production" &&
      process.env.SURFACE_KIOSK !== "1" &&
      !app.isPackaged);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f1115",
    fullscreen,
    kiosk: fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  if (useDevServer) {
    mainWindow.loadURL(devServerUrl());
  } else {
    mainWindow.loadURL("kiosk://app/index.html");
  }

  // Self-heal: if the renderer crashes (e.g. a GPU hiccup takes it down), reload
  // it instead of leaving a dead kiosk on the wall.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer gone: ${details.reason}`);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.reload();
      } else {
        createWindow();
      }
    }, 1500);
  });

  mainWindow.webContents.on("unresponsive", () => {
    console.error("Renderer unresponsive; reloading.");
    mainWindow?.reload();
  });
}

app.on("child-process-gone", (_event, details) => {
  if (details.type === "GPU") {
    console.error(`GPU process gone: ${details.reason} (${details.exitCode})`);
  }
});

app.whenReady().then(() => {
  registerKioskProtocol();
  allowConfiguredHomeAssistantCertificates();
  relaxHomeAssistantFrameHeaders();

  ipcMain.handle("config:read", readConfig);
  ipcMain.handle("config:write", writeConfig);
  ipcMain.handle("enrollments:read", readEnrollments);
  ipcMain.handle("enrollments:write", writeEnrollments);
  ipcMain.handle("models:check", checkModels);
  ipcMain.handle("ha:test", (_event, config: KioskConfig) =>
    getHomeAssistant(config),
  );
  ipcMain.handle("ha:fire-event", async (_event, eventType: string, payload) =>
    postHomeAssistant(`/api/events/${encodeURIComponent(eventType)}`, payload),
  );
  ipcMain.handle(
    "ha:call-service",
    async (_event, domain: string, service: string, payload) =>
      postHomeAssistant(
        `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
        payload,
      ),
  );
  ipcMain.handle("ha:get-states", () => getHomeAssistantStatesFiltered());
  ipcMain.handle("ha:get-calendar", (_event, entityId: string, start: string, end: string) =>
    getHomeAssistantJson(
      `/api/calendars/${encodeURIComponent(entityId)}?start=${encodeURIComponent(
        start,
      )}&end=${encodeURIComponent(end)}`,
    ),
  );
  ipcMain.handle("ha:get-state", (_event, entityId: string) =>
    getHomeAssistantJson(`/api/states/${encodeURIComponent(entityId)}`),
  );
  ipcMain.handle(
    "ha:calendar-delete",
    (
      _event,
      entityId: string,
      uid: string,
      recurrenceId?: string | null,
      recurrenceRange?: string | null,
    ) =>
      haWebSocketCommand({
        type: "calendar/event/delete",
        entity_id: entityId,
        uid,
        ...(recurrenceId ? { recurrence_id: recurrenceId } : {}),
        ...(recurrenceRange ? { recurrence_range: recurrenceRange } : {}),
      }),
  );
  ipcMain.handle("ha:get-camera-snapshot", (_event, entityId: string) =>
    getHomeAssistantCameraSnapshot(entityId),
  );
  ipcMain.handle("travel:estimate", (_event, destText: string) => estimateTravel(destText));
  ipcMain.handle("ha:todo-list", (_event, entityId: string) =>
    haWebSocketCommand({ type: "todo/item/list", entity_id: entityId }),
  );
  ipcMain.handle("photos:icloud-album", (_event, albumUrl: string) =>
    fetchIcloudAlbumPhotos(albumUrl),
  );
  ipcMain.handle("reminders:items", () =>
    bridgeFetch(`/items?list=${encodeURIComponent(reminderBridge().list)}`),
  );
  ipcMain.handle("reminders:add", (_event, title: string) =>
    bridgeFetch("/add", { method: "POST", body: { list: reminderBridge().list, title } }),
  );
  ipcMain.handle("reminders:complete", (_event, id: string) =>
    bridgeFetch("/complete", { method: "POST", body: { id } }),
  );
  ipcMain.handle("reminders:uncomplete", (_event, id: string) =>
    bridgeFetch("/uncomplete", { method: "POST", body: { id } }),
  );
  ipcMain.handle("reminders:delete", (_event, id: string) =>
    bridgeFetch("/delete", { method: "POST", body: { id } }),
  );
  ipcMain.handle("reminders:health", () => bridgeFetch("/health"));
  ipcMain.handle(
    "reminders:test",
    async (_event, url: string, token: string, list: string) => {
      const base = (url ?? "").trim().replace(/\/$/, "");
      if (!base) return { ok: false, error: "No bridge URL" };
      try {
        const health = await net
          .fetch(`${base}/health`, { signal: AbortSignal.timeout(8000) })
          .then((r) => r.json());
        const items = (await net
          .fetch(`${base}/items?list=${encodeURIComponent(list || "Grocery")}`, {
            headers: { Authorization: `Bearer ${token ?? ""}` },
            signal: AbortSignal.timeout(8000),
          })
          .then((r) => r.json())) as { ok?: boolean; items?: unknown[]; error?: string };
        if (!health?.ok) return { ok: false, error: "Bridge not responding" };
        if (!items?.ok) return { ok: false, error: items?.error || "Unauthorized (check token)" };
        return { ok: true, count: Array.isArray(items.items) ? items.items.length : 0 };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "unreachable" };
      }
    },
  );
  ipcMain.handle("window:kiosk", (_event, enabled: boolean) => {
    mainWindow?.setKiosk(enabled);
    mainWindow?.setFullScreen(enabled);
  });
  ipcMain.handle("window:display-power", (_event, enabled: boolean) =>
    setWindowsDisplayPower(enabled),
  );
  ipcMain.handle("window:reload", () => mainWindow?.webContents.reload());

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
