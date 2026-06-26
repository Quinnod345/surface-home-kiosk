import { useEffect, useState } from "react";
import type { KioskConfig } from "./config";

export type NativeBridgeStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "error";

export type NativeBridgeFrame = {
  dataUrl: string;
  sourceKind: string;
  at: string;
};

type BridgeFrameMessage = {
  type: "frame";
  sourceKind: string;
  mimeType: string;
  imageBase64: string;
  at: string;
};

type BridgeErrorMessage = {
  type: "error";
  error: string;
};

export function useNativeBridgeFrames(
  config: KioskConfig,
  active: boolean = config.nativeBridge.enabled,
) {
  const shouldConnect = config.nativeBridge.enabled && active;
  const [status, setStatus] = useState<NativeBridgeStatus>(
    shouldConnect ? "connecting" : "disabled",
  );
  const [frame, setFrame] = useState<NativeBridgeFrame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldConnect) {
      // Closing the socket makes the bridge release the infrared session, which
      // turns the emitter off when the room is lit.
      setStatus("disabled");
      setFrame(null);
      setError(null);
      return;
    }

    let closed = false;
    setStatus("connecting");
    setError(null);

    const socket = new WebSocket(config.nativeBridge.url);
    socket.addEventListener("open", () => {
      if (!closed) setStatus("connected");
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as
          | BridgeFrameMessage
          | BridgeErrorMessage;

        if (message.type === "error") {
          setStatus("error");
          setError(message.error);
          return;
        }

        if (message.type === "frame") {
          setStatus("connected");
          setFrame({
            sourceKind: message.sourceKind,
            at: message.at,
            dataUrl: `data:${message.mimeType};base64,${message.imageBase64}`,
          });
        }
      } catch (parseError) {
        setStatus("error");
        setError(parseError instanceof Error ? parseError.message : "Bad bridge frame");
      }
    });
    socket.addEventListener("error", () => {
      if (!closed) {
        setStatus("error");
        setError("Native camera bridge connection failed.");
      }
    });
    socket.addEventListener("close", () => {
      if (!closed) setStatus("error");
    });

    return () => {
      closed = true;
      socket.close();
    };
  }, [shouldConnect, config.nativeBridge.url]);

  return { status, frame, error };
}
