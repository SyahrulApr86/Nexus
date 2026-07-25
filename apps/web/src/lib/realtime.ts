import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeEvent } from "@nexus/shared";

export type ConnectionState = "connected" | "connecting" | "offline";

/**
 * US10: live sync channel. Invalidates the right queries when other sessions
 * change the vault; exposes connection state for the offline indicator.
 */
export function useRealtime(): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retryMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      setState((s) => (s === "connected" ? s : "connecting"));
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/ws`);

      ws.onopen = () => {
        retryMs = 1000;
        setState("connected");
      };
      ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as RealtimeEvent | { type: string };
          switch (event.type) {
            case "note:created":
            case "note:deleted":
              qc.invalidateQueries({ queryKey: ["notes"] });
              qc.invalidateQueries({ queryKey: ["folders"] });
              qc.invalidateQueries({ queryKey: ["tags"] });
              qc.invalidateQueries({ queryKey: ["graph"] });
              break;
            case "note:updated": {
              const e = event as Extract<RealtimeEvent, { type: "note:updated" }>;
              qc.invalidateQueries({ queryKey: ["notes"] });
              qc.invalidateQueries({ queryKey: ["note", e.noteId] });
              qc.invalidateQueries({ queryKey: ["tags"] });
              qc.invalidateQueries({ queryKey: ["graph"] });
              break;
            }
            case "folder:changed":
              qc.invalidateQueries({ queryKey: ["folders"] });
              qc.invalidateQueries({ queryKey: ["notes"] });
              break;
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setState(navigator.onLine ? "connecting" : "offline");
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 15_000);
      };
      ws.onerror = () => ws?.close();
    };

    const onOnline = () => connect();
    const onOffline = () => setState("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      ws?.close();
    };
  }, [qc]);

  return state;
}
