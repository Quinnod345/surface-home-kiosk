import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("surfaceKiosk", {
  readConfig: () => ipcRenderer.invoke("config:read"),
  saveConfig: (config: unknown) => ipcRenderer.invoke("config:write", config),
  readEnrollments: () => ipcRenderer.invoke("enrollments:read"),
  writeEnrollments: (store: unknown) =>
    ipcRenderer.invoke("enrollments:write", store),
  checkModels: () => ipcRenderer.invoke("models:check"),
  testHomeAssistant: (config: unknown) => ipcRenderer.invoke("ha:test", config),
  fireHomeAssistantEvent: (eventType: string, payload: unknown) =>
    ipcRenderer.invoke("ha:fire-event", eventType, payload),
  callHomeAssistantService: (
    domain: string,
    service: string,
    payload: unknown,
  ) => ipcRenderer.invoke("ha:call-service", domain, service, payload),
  getHomeAssistantStates: () => ipcRenderer.invoke("ha:get-states"),
  getHomeAssistantState: (entityId: string) =>
    ipcRenderer.invoke("ha:get-state", entityId),
  getHomeAssistantCameraSnapshot: (entityId: string) =>
    ipcRenderer.invoke("ha:get-camera-snapshot", entityId),
  setKioskMode: (enabled: boolean) => ipcRenderer.invoke("window:kiosk", enabled),
  setDisplayPower: (enabled: boolean) =>
    ipcRenderer.invoke("window:display-power", enabled),
  reload: () => ipcRenderer.invoke("window:reload"),
});
