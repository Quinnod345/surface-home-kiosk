import type { KioskConfig } from "../config";
import type { EnrollmentStore } from "../enrollmentStore";

declare global {
  interface Window {
    surfaceKiosk?: {
      readConfig: () => Promise<KioskConfig>;
      saveConfig: (config: KioskConfig) => Promise<KioskConfig>;
      readEnrollments: () => Promise<EnrollmentStore>;
      writeEnrollments: (store: EnrollmentStore) => Promise<EnrollmentStore>;
      checkModels: () => Promise<{
        modelsDir: string;
        ok: boolean;
        files: { name: string; exists: boolean; size: number }[];
      }>;
      testHomeAssistant: (config: Pick<KioskConfig, "homeAssistant">) => Promise<unknown>;
      fireHomeAssistantEvent: (
        eventType: string,
        payload: unknown,
      ) => Promise<unknown>;
      callHomeAssistantService: (
        domain: string,
        service: string,
        payload: unknown,
      ) => Promise<unknown>;
      getHomeAssistantStates: () => Promise<unknown>;
      getCalendar: (
        entityId: string,
        start: string,
        end: string,
      ) => Promise<unknown>;
      deleteCalendarEvent: (
        entityId: string,
        uid: string,
        recurrenceId?: string | null,
        recurrenceRange?: string | null,
      ) => Promise<unknown>;
      getHomeAssistantState: (entityId: string) => Promise<unknown>;
      getHomeAssistantCameraSnapshot: (entityId: string) => Promise<{
        entityId: string;
        contentType: string;
        dataUrl: string;
        at: string;
      }>;
      estimateTravel: (destText: string) => Promise<
        | { ok: true; durationMin: number; distanceMiles: number; destName: string }
        | { ok: false; reason: string }
      >;
      listTodo: (entityId: string) => Promise<{
        items: {
          uid: string;
          summary: string;
          status: "needs_action" | "completed";
          due?: string | null;
          description?: string | null;
        }[];
      }>;
      getIcloudAlbumPhotos: (albumUrl: string) => Promise<
        { type: "image" | "video"; url: string; poster?: string }[]
      >;
      remindersItems: () => Promise<{
        ok: boolean;
        items?: { id: string; title: string; completed: boolean; list?: string; due?: string }[];
        error?: string;
      }>;
      remindersAdd: (title: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
      remindersComplete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      remindersUncomplete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      remindersDelete: (id: string) => Promise<{ ok: boolean; error?: string }>;
      remindersHealth: () => Promise<{ ok: boolean; service?: string }>;
      remindersTest: (
        url: string,
        token: string,
        list: string,
      ) => Promise<{ ok: boolean; count?: number; error?: string }>;
      setKioskMode: (enabled: boolean) => Promise<void>;
      setDisplayPower: (enabled: boolean) => Promise<unknown>;
      reload: () => Promise<void>;
    };
  }
}

export {};
