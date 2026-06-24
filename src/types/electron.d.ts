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
      setKioskMode: (enabled: boolean) => Promise<void>;
      reload: () => Promise<void>;
    };
  }
}

export {};
