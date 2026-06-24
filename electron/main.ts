import { app, BrowserWindow, ipcMain, net, protocol, session } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
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
}

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
  ipcMain.handle("ha:get-states", () => getHomeAssistantJson("/api/states"));
  ipcMain.handle("ha:get-state", (_event, entityId: string) =>
    getHomeAssistantJson(`/api/states/${encodeURIComponent(entityId)}`),
  );
  ipcMain.handle("ha:get-camera-snapshot", (_event, entityId: string) =>
    getHomeAssistantCameraSnapshot(entityId),
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
