import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("surfaceKiosk", {
  readConfig: () => ipcRenderer.invoke("config:read"),
  fireHomeAssistantEvent: (eventType: string, payload: unknown) =>
    ipcRenderer.invoke("ha:fire-event", eventType, payload),
  callHomeAssistantService: (
    domain: string,
    service: string,
    payload: unknown,
  ) => ipcRenderer.invoke("ha:call-service", domain, service, payload),
  setKioskMode: (enabled: boolean) => ipcRenderer.invoke("window:kiosk", enabled),
  reload: () => ipcRenderer.invoke("window:reload"),
});
