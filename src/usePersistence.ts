import { useCallback, useEffect, useRef, useState } from "react";
import { browserWorkspace, useBridgeWorkspace } from "./bridge";
import { WRITING_PAUSE_MS } from "./Canvas";
import { initialData, type AppData } from "./model";
import { loadData, saveData } from "./storage";

export type SaveState = "saved" | "saving" | "error";

/**
 * Loads the signed-in workspace, saves after each writing pause and on hide,
 * and detects edits from other windows. Never writes over unreadable data.
 */
export function usePersistence() {
  const [data, setData] = useState<AppData | null>(null),
    [loadError, setLoadError] = useState(""),
    [accountRequired, setAccountRequired] = useState(false),
    [saving, setSaving] = useState<SaveState>("saved"),
    [saveError, setSaveError] = useState(""),
    [externalEdit, setExternalEdit] = useState(false);
  const workspace = useRef<string | null>(null),
    current = useRef(data),
    lastSaved = useRef<AppData | null>(null),
    queue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    strokeActive = useRef(false),
    lastStrokeEnd = useRef(-Infinity),
    channel = useRef<BroadcastChannel | null>(null);
  current.current = data;

  const persist = useCallback((d: AppData) => {
    const scope = workspace.current;
    if (!scope) return;
    setSaving("saving");
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveData(d, scope, lastSaved.current))
      .then(() => {
        lastSaved.current = d;
        if (current.current === d) setSaving("saved");
        setSaveError("");
        channel.current?.postMessage("saved");
      })
      .catch((e) => {
        setSaving("error");
        setSaveError(
          e instanceof Error ? e.message : "Speichern fehlgeschlagen",
        );
      });
  }, []);

  useEffect(() => {
    let mounted = true;
    browserWorkspace(true)
      .then(async (scope) => {
        if (!mounted) return;
        if (!scope) {
          setAccountRequired(true);
          return;
        }
        workspace.current = scope;
        useBridgeWorkspace(scope);
        const d = await loadData(scope);
        if (!mounted) return;
        lastSaved.current = d;
        setData(d || initialData());
      })
      .catch((e) => {
        if (mounted)
          setLoadError(
            e instanceof Error ? e.message : "Speicher nicht verfügbar",
          );
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Save once the pen has rested, so a long writing session never stutters.
  useEffect(() => {
    if (!data || data === lastSaved.current || externalEdit) return;
    setSaving("saving");
    clearTimeout(timer.current);
    const saveWhenIdle = () => {
      const remaining =
        WRITING_PAUSE_MS - (performance.now() - lastStrokeEnd.current);
      if (strokeActive.current || remaining > 0) {
        timer.current = setTimeout(saveWhenIdle, Math.max(50, remaining));
      } else {
        persist(data);
      }
    };
    timer.current = setTimeout(saveWhenIdle, 350);
    return () => clearTimeout(timer.current);
  }, [data, persist, externalEdit]);

  useEffect(() => {
    const flush = () => {
      clearTimeout(timer.current);
      if (
        current.current &&
        current.current !== lastSaved.current &&
        !externalEdit
      )
        persist(current.current);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (current.current !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [persist, externalEdit]);

  const loaded = !!data;
  useEffect(() => {
    if (!workspace.current || typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel("inkloop-changes-" + workspace.current);
    channel.current = c;
    c.onmessage = () => setExternalEdit(true);
    return () => {
      c.close();
      channel.current = null;
    };
  }, [loaded]);

  return {
    data,
    setData,
    current,
    workspace,
    loadError,
    setLoadError,
    accountRequired,
    saving,
    saveError,
    externalEdit,
    /** Canvas reports pen-down/up so saving waits for the writing pause. */
    strokeActivity: (active: boolean) => {
      strokeActive.current = active;
    },
    strokeEnded: () => {
      lastStrokeEnd.current = performance.now();
    },
  };
}
