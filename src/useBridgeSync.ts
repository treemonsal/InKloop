import { useEffect, useRef, useState, type RefObject } from "react";
import {
  bridgeStatus,
  publishWorkspace,
  WorkspaceChanged,
  type BridgeEvent,
} from "./bridge";
import type { AppData } from "./model";

const POLL_MS = 6000;

/**
 * Polls the private ChatGPT bridge while the notebook is visible and keeps the
 * server's notebook index in step with local names and pages.
 */
export function useBridgeSync({
  current,
  loaded,
  paused,
  workspaceKey,
  onEvents,
  onAccountChanged,
}: {
  current: RefObject<AppData | null>;
  loaded: boolean;
  paused: boolean;
  workspaceKey: string;
  onEvents: (events: BridgeEvent[], cursor: string) => void;
  onAccountChanged: () => void;
}) {
  const [ready, setReady] = useState(false);
  const handlers = useRef({ onEvents, onAccountChanged });
  handlers.current = { onEvents, onAccountChanged };

  useEffect(() => {
    if (!loaded || paused) return;
    let stopped = false,
      inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await bridgeStatus(current.current?.bridgeCursor || "");
        if (!stopped) {
          setReady(result.ok);
          if (result.events.length)
            handlers.current.onEvents(result.events, result.cursor);
        }
      } catch (error) {
        if (!stopped) {
          setReady(false);
          if (error instanceof WorkspaceChanged)
            handlers.current.onAccountChanged();
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(poll, POLL_MS);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [loaded, paused, current]);

  useEffect(() => {
    if (!ready || !current.current || paused) return;
    const timer = setTimeout(() => {
      if (current.current) publishWorkspace(current.current).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [workspaceKey, ready, paused, current]);

  return ready;
}

export function workspaceKeyOf(data: AppData | null) {
  return data
    ? JSON.stringify({
        activeNotebook: data.activeNotebook,
        activePage: data.activePage,
        notebooks: data.notebooks.map((n) => ({
          id: n.id,
          name: n.name,
          subject: n.subject,
          language: n.language,
          pages: n.pages.map((p) => ({ id: p.id, title: p.title })),
        })),
      })
    : "";
}
