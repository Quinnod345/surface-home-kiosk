import type { KioskConfig } from "../config";

declare global {
  interface Window {
    surfaceKiosk?: {
      readConfig: () => Promise<KioskConfig>;
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
