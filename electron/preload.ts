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
  getCalendar: (entityId: string, start: string, end: string) =>
    ipcRenderer.invoke("ha:get-calendar", entityId, start, end),
  deleteCalendarEvent: (
    entityId: string,
    uid: string,
    recurrenceId?: string | null,
    recurrenceRange?: string | null,
  ) => ipcRenderer.invoke("ha:calendar-delete", entityId, uid, recurrenceId, recurrenceRange),
  getHomeAssistantState: (entityId: string) =>
    ipcRenderer.invoke("ha:get-state", entityId),
  getHomeAssistantCameraSnapshot: (entityId: string) =>
    ipcRenderer.invoke("ha:get-camera-snapshot", entityId),
  estimateTravel: (destText: string) => ipcRenderer.invoke("travel:estimate", destText),
  listTodo: (entityId: string) => ipcRenderer.invoke("ha:todo-list", entityId),
  getIcloudAlbumPhotos: (albumUrl: string) =>
    ipcRenderer.invoke("photos:icloud-album", albumUrl),
  remindersItems: () => ipcRenderer.invoke("reminders:items"),
  remindersAdd: (title: string) => ipcRenderer.invoke("reminders:add", title),
  remindersComplete: (id: string) => ipcRenderer.invoke("reminders:complete", id),
  remindersUncomplete: (id: string) => ipcRenderer.invoke("reminders:uncomplete", id),
  remindersDelete: (id: string) => ipcRenderer.invoke("reminders:delete", id),
  remindersHealth: () => ipcRenderer.invoke("reminders:health"),
  remindersTest: (url: string, token: string, list: string) =>
    ipcRenderer.invoke("reminders:test", url, token, list),
  setKioskMode: (enabled: boolean) => ipcRenderer.invoke("window:kiosk", enabled),
  setDisplayPower: (enabled: boolean) =>
    ipcRenderer.invoke("window:display-power", enabled),
  reload: () => ipcRenderer.invoke("window:reload"),
});
