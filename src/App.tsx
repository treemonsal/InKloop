import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileText,
  Fingerprint,
  Library,
  PanelLeft,
  HelpCircle,
  Highlighter,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  PenLine,
  Plus,
  Redo2,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
  Minus,
  Trash2,
  CircleCheck,
} from "lucide-react";
import {
  bridgeStatus,
  publishWorkspace,
  publishSubmission,
  deleteSharedPage,
  type BridgeEvent,
} from "./bridge";
import InkCanvas, { type Tool } from "./Canvas";
import {
  type AppData,
  type Notebook,
  type Page,
  type Stroke,
  type Submission,
  type Sample,
  initialData,
  newNotebook,
  newPage,
  uid,
  chatLink,
  buildPrompt,
  parseBackup,
  parseResponse,
  receiveTask,
  MAX_TEXT_LENGTH,
} from "./model";
import { loadData, saveData, readStoredData, download } from "./storage";
import { submissionImage, thumbnail } from "./ink";

const MarkdownText = lazy(() => import("./RichText"));
function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Logo() {
  return <img src="./icon.svg" alt="" width={32} height={32} />;
}
function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
    const dialog = ref.current;
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <IconButton label="Schließen" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
function Miniature({ strokes }: { strokes: Stroke[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) thumbnail(ref.current, strokes);
  }, [strokes]);
  return <canvas ref={ref} aria-hidden="true" />;
}
const palette = ["#f4f5f7", "#a9abb2", "#a7c4ff"];
const compactLayout =
  "(max-width: 720px), (orientation: portrait) and (max-width: 1180px)";
const prefersCompactLayout = () => window.matchMedia(compactLayout).matches;
const sampleLabels = [
  "a g q y z · b d p · m n u · I l 1",
  "0 O · 1 7 · 2 Z · 5 S · 8 B · 6 9",
  "x² + 3x = 12 · ½ · −4,75 · CHF 1’250.00",
  "Soll / Haben · Aufwand / Ertrag · The quick brown fox.",
];
type Sheet =
  | "profile"
  | "settings"
  | "newNotebook"
  | "task"
  | "submit"
  | "import"
  | "help"
  | "pageMenu"
  | null;

export default function App() {
  const [data, setData] = useState<AppData | null>(null),
    [loadError, setLoadError] = useState(""),
    [saving, setSaving] = useState<"saved" | "saving" | "error">("saved"),
    [saveError, setSaveError] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null),
    [inLibrary, setInLibrary] = useState(true),
    [sidebar, setSidebar] = useState(false),
    [compact, setCompact] = useState(prefersCompactLayout),
    [panelOpen, setPanelOpen] = useState(() => !prefersCompactLayout()),
    [tab, setTab] = useState<"task" | "text" | "feedback">("task"),
    [tool, setTool] = useState<Tool>("pen"),
    [color, setColor] = useState(palette[0]),
    [width, setWidth] = useState(2.5),
    [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState(""),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [newName, setNewName] = useState(""),
    [profileStep, setProfileStep] = useState(0),
    [sampleInk, setSampleInk] = useState<Stroke[]>([]),
    [profileDraft, setProfileDraft] = useState<Sample[]>([]),
    [profileFinger, setProfileFinger] = useState(false),
    [prepared, setPrepared] = useState<{
      blob: Blob;
      url: string;
      prompt: string;
      submission: Submission;
      shared: boolean;
    } | null>(null),
    [selectedSubmission, setSelectedSubmission] = useState<string | null>(null),
    [externalEdit, setExternalEdit] = useState(false),
    [bridgeReady, setBridgeReady] = useState(false);
  const current = useRef(data);
  current.current = data;
  const lastSaved = useRef<AppData | null>(null),
    saveQueue = useRef(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    history = useRef(
      new Map<string, { past: Stroke[][]; future: Stroke[][] }>(),
    ),
    [historyVersion, setHistoryVersion] = useState(0),
    channel = useRef<BroadcastChannel | null>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const restoreCandidate = useRef<AppData | null>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const learningPanel = useRef<HTMLElement>(null);
  const closeLearningPanel = () => {
    setPanelOpen(false);
    panelToggle.current?.focus();
  };
  useEffect(() => {
    if (compact && panelOpen && !inLibrary)
      learningPanel.current
        ?.querySelector<HTMLElement>('[aria-selected="true"]')
        ?.focus();
  }, [compact, panelOpen, inLibrary]);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4500);
  }, []);
  const persist = useCallback((d: AppData) => {
    setSaving("saving");
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => saveData(d))
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
    const query = window.matchMedia(compactLayout);
    const update = () => {
      setCompact(query.matches);
      setPanelOpen(!query.matches);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    let mounted = true;
    loadData()
      .then((d) => {
        if (!mounted) return;
        const value = d || initialData();
        lastSaved.current = d;
        setData(value);
      })
      .catch((e) => {
        if (mounted)
          setLoadError(
            e instanceof Error ? e.message : "Speicher nicht verfügbar",
          );
      });
    return () => {
      mounted = false;
      clearTimeout(toastTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!data || data === lastSaved.current || externalEdit) return;
    setSaving("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(data), 350);
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
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", flush);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (current.current !== lastSaved.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [persist, externalEdit]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel("inkloop-changes");
    channel.current = c;
    c.onmessage = () => setExternalEdit(true);
    return () => {
      c.close();
      channel.current = null;
    };
  }, []);
  useEffect(() => {
    if (!prepared) return;
    return () => URL.revokeObjectURL(prepared.url);
  }, [prepared]);
  const applyBridgeEvents = useCallback(
    (events: BridgeEvent[], cursor: string) => {
      if (!events.length) return;
      const before = current.current;
      setData((old) => {
        if (!old || old.bridgeCursor === cursor) return old;
        let next = old;
        for (const event of events) {
          if (event.type === "response")
            next = {
              ...next,
              notebooks: next.notebooks.map((n) =>
                n.id === event.notebookId
                  ? {
                      ...n,
                      pages: n.pages.map((p) =>
                        p.id === event.pageId
                          ? {
                              ...p,
                              submissions: p.submissions.map((s) =>
                                s.id === event.submissionId
                                  ? {
                                      ...s,
                                      transcription: event.transcription || "",
                                      feedback: event.feedback || "",
                                      nextTask: event.nextTask || "",
                                    }
                                  : s,
                              ),
                            }
                          : p,
                      ),
                    }
                  : n,
              ),
            };
          if (event.type === "task" && event.task)
            next = receiveTask(
              next,
              event.notebookId,
              event.id,
              event.task,
              event.language,
            );
        }
        return { ...next, bridgeCursor: cursor };
      });
      const activeResponse = events.find(
        (e) => e.type === "response" && e.pageId === before?.activePage,
      );
      if (activeResponse) {
        setSelectedSubmission(activeResponse.submissionId || null);
        setTab("feedback");
        if (!prefersCompactLayout()) setPanelOpen(true);
      }
      notify(
        events.some((e) => e.type === "response")
          ? "Antwort aus deinem ChatGPT-Chat empfangen."
          : "Neue Aufgabe aus deinem ChatGPT-Chat empfangen.",
      );
    },
    [notify],
  );
  useEffect(() => {
    if (!data || externalEdit) return;
    let stopped = false,
      inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const result = await bridgeStatus(current.current?.bridgeCursor || "");
        if (!stopped) {
          setBridgeReady(result.ok);
          applyBridgeEvents(result.events, result.cursor);
        }
      } catch {
        if (!stopped) setBridgeReady(false);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const interval = setInterval(poll, 6000);
    window.addEventListener("focus", poll);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener("focus", poll);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [!!data, externalEdit, applyBridgeEvents]);
  const workspaceKey = data
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
  useEffect(() => {
    if (!bridgeReady || !current.current || externalEdit) return;
    const timer = setTimeout(() => {
      if (current.current) publishWorkspace(current.current).catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [workspaceKey, bridgeReady, externalEdit]);
  const notebook = data?.notebooks.find((n) => n.id === data.activeNotebook),
    page = notebook?.pages.find((p) => p.id === data?.activePage);
  const submission =
    page?.submissions.find((s) => s.id === selectedSubmission) ||
    page?.submissions.at(-1);
  const patchNotebook = (patch: Partial<Notebook>) =>
    setData((d) =>
      d
        ? {
            ...d,
            notebooks: d.notebooks.map((n) =>
              n.id === d.activeNotebook ? { ...n, ...patch } : n,
            ),
          }
        : d,
    );
  const patchPage = (patch: Partial<Page>) =>
    setData((d) =>
      d
        ? {
            ...d,
            notebooks: d.notebooks.map((n) =>
              n.id === d.activeNotebook
                ? {
                    ...n,
                    pages: n.pages.map((p) =>
                      p.id === d.activePage
                        ? { ...p, ...patch, updatedAt: Date.now() }
                        : p,
                    ),
                  }
                : n,
            ),
          }
        : d,
    );
  const changeInk = (strokes: Stroke[]) => {
    if (!page || externalEdit) return;
    const h = history.current.get(page.id) || { past: [], future: [] };
    h.past.push(page.strokes);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    history.current.set(page.id, h);
    setHistoryVersion((v) => v + 1);
    setData((d) =>
      d
        ? {
            ...d,
            notebooks: d.notebooks.map((n) => ({
              ...n,
              pages: n.pages.map((p) =>
                p.id === page.id ? { ...p, strokes, updatedAt: Date.now() } : p,
              ),
            })),
          }
        : d,
    );
  };
  const undo = (redo = false) => {
    if (!page) return;
    const h = history.current.get(page.id);
    if (!h) return;
    const stack = redo ? h.future : h.past;
    const strokes = stack.pop();
    if (strokes) {
      (redo ? h.past : h.future).push(page.strokes);
      patchPage({ strokes });
      setHistoryVersion((v) => v + 1);
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !sheet) {
        if (sidebar) setSidebar(false);
        else if (compact && panelOpen) closeLearningPanel();
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z" &&
        !sheet &&
        !inLibrary &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        undo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const open = (s: Sheet, value = "") => {
    setError("");
    setDraft(value);
    setSheet(s);
  };
  const close = () => {
    if (busy) return;
    setSheet(null);
    restoreCandidate.current = null;
    setError("");
    if (sheet === "submit") setPrepared(null);
  };
  const openNotebook = (n: Notebook) => {
    setData((d) => {
      if (!d || d.activeNotebook === n.id) return d;
      const last = n.pages.find((p) => p.id === n.lastPageId);
      return {
        ...d,
        activeNotebook: n.id,
        activePage: last?.id ?? n.pages[0].id,
      };
    });
    setSelectedSubmission(null);
    setZoom(1);
    setTab("task");
    setSidebar(false);
    setPanelOpen(!prefersCompactLayout());
    setInLibrary(false);
  };
  const openLibrary = () => {
    setSidebar(false);
    setInLibrary(true);
  };
  const startProfile = () => {
    setProfileStep(0);
    setSampleInk([]);
    setProfileDraft([]);
    setProfileFinger(data?.settings.touchWriting || false);
    open("profile");
  };
  const navigatePage = (id: string) => {
    setData(
      (d) =>
        d && {
          ...d,
          activePage: id,
          notebooks: d.notebooks.map((n) =>
            n.id === d.activeNotebook ? { ...n, lastPageId: id } : n,
          ),
        },
    );
    setSelectedSubmission(null);
    setZoom(1);
  };
  const addPage = (task = "") => {
    if (!notebook) return;
    const p = { ...newPage(`Seite ${notebook.pages.length + 1}`), task };
    setData((d) =>
      d
        ? {
            ...d,
            activePage: p.id,
            notebooks: d.notebooks.map((n) =>
              n.id === d.activeNotebook
                ? { ...n, pages: [...n.pages, p], lastPageId: p.id }
                : n,
            ),
          }
        : d,
    );
    setSelectedSubmission(null);
    setZoom(1);
    setSidebar(false);
  };
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("In die Zwischenablage kopiert.");
    } catch {
      setError(
        "Kopieren nicht verfügbar. Markiere den Text und kopiere ihn manuell.",
      );
    }
  };
  const showHandoff = async (
    n: Notebook,
    pageId: string,
    submission: Submission,
    handoff: NonNullable<Submission["handoff"]>,
    send: boolean,
  ) => {
    if (!data || busy || externalEdit) return;
    setBusy(true);
    setError("");
    try {
      const source = {
        ...n,
        subject: handoff.subject,
        language: handoff.language,
      };
      const blob = await submissionImage(source, submission, handoff.samples);
      const prompt = buildPrompt(source, submission, handoff.samples.length);
      let shared = handoff.sent;
      if (send) {
        try {
          await publishSubmission(source, pageId, submission, blob, prompt);
          shared = true;
          setData(
            (d) =>
              d && {
                ...d,
                notebooks: d.notebooks.map((book) =>
                  book.id === n.id
                    ? {
                        ...book,
                        pages: book.pages.map((p) =>
                          p.id === pageId
                            ? {
                                ...p,
                                submissions: p.submissions.map((s) =>
                                  s.id === submission.id
                                    ? {
                                        ...s,
                                        handoff: { ...handoff, sent: true },
                                      }
                                    : s,
                                ),
                              }
                            : p,
                        ),
                      }
                    : book,
                ),
              },
          );
        } catch {
          notify(
            "Senden fehlgeschlagen. Du kannst es bei dieser Abgabe erneut versuchen.",
          );
        }
      }
      if (current.current?.activePage === pageId) {
        setPrepared({
          blob,
          url: URL.createObjectURL(blob),
          prompt,
          submission,
          shared,
        });
        setSelectedSubmission(submission.id);
        setSheet("submit");
      }
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Das Abgabebild konnte nicht erstellt werden.",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepareSubmission = () => {
    if (
      !data ||
      !notebook ||
      !page ||
      !page.strokes.length ||
      busy ||
      externalEdit
    )
      return;
    const handoff = {
      subject: notebook.subject,
      language: notebook.language,
      samples: data.settings.includeProfile ? data.samples : [],
      sent: false,
    };
    const s: Submission = {
      id: uid(),
      createdAt: Date.now(),
      strokes: structuredClone(page.strokes),
      task: page.task,
      transcription: "",
      feedback: "",
      nextTask: "",
      handoff,
    };
    patchPage({ submissions: [...page.submissions, s] });
    void showHandoff(
      notebook,
      page.id,
      s,
      handoff,
      bridgeReady && data.settings.provider === "chatgpt",
    );
  };
  const deletePage = async (includeServer: boolean) => {
    if (!notebook || !page || busy || externalEdit) return;
    setBusy(true);
    setError("");
    try {
      if (includeServer) {
        await deleteSharedPage(
          page.id,
          page.submissions.map((s) => s.id),
        );
      }
      setData((d) => {
        if (!d) return d;
        const target = d.notebooks.find((n) => n.id === notebook.id);
        if (!target) return d;
        const index = target.pages.findIndex((p) => p.id === page.id);
        if (index < 0) return d;
        const pages = target.pages.filter((p) => p.id !== page.id);
        if (!pages.length) pages.push(newPage("Seite 1"));
        const replacement = pages[Math.max(0, index - 1)].id;
        return {
          ...d,
          activePage: d.activePage === page.id ? replacement : d.activePage,
          notebooks: d.notebooks.map((n) =>
            n === target
              ? {
                  ...n,
                  pages,
                  lastPageId:
                    n.lastPageId === page.id ? replacement : n.lastPageId,
                }
              : n,
          ),
        };
      });
      history.current.delete(page.id);
      setSelectedSubmission(null);
      setZoom(1);
      close();
      notify(
        includeServer
          ? "Seite und Serverkopien gelöscht."
          : "Seite auf diesem Gerät gelöscht.",
      );
    } catch {
      setError(
        "Serverkopien konnten nicht vollständig gelöscht werden. Die Seite bleibt hier. Versuche es erneut.",
      );
    } finally {
      setBusy(false);
    }
  };
  const applyResponse = () => {
    if (!page || !draft.trim()) return;
    try {
      const result = parseResponse(draft);
      if (submission) {
        patchPage({
          submissions: page.submissions.map((s) =>
            s.id === submission.id ? { ...s, ...result } : s,
          ),
        });
      } else {
        const s: Submission = {
          id: uid(),
          createdAt: Date.now(),
          strokes: structuredClone(page.strokes),
          task: page.task,
          ...result,
        };
        patchPage({ submissions: [...page.submissions, s] });
        setSelectedSubmission(s.id);
      }
      setTab(result.transcription ? "text" : "feedback");
      setPanelOpen(true);
      close();
      notify("Antwort im Lernheft gespeichert.");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const backup = () => {
    if (!data) return;
    download(
      new Blob([JSON.stringify(data)], { type: "application/json" }),
      `inkloop-sicherung-${new Date().toISOString().slice(0, 10)}.json`,
    );
    notify("Sicherung wird heruntergeladen.");
  };
  const restore = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      restoreCandidate.current = parseBackup(await file.text());
      open("settings");
      setError("restore-confirm");
    } catch (e) {
      notify((e as Error).message);
    }
    if (importFile.current) importFile.current.value = "";
  };
  const fileName = `inkloop-${notebook?.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "antwort"}.png`;
  const editSubmission = (patch: Partial<Submission>) => {
    if (!page || !submission) return;
    patchPage({
      submissions: page.submissions.map((s) =>
        s.id === submission.id ? { ...s, ...patch } : s,
      ),
    });
  };
  if (loadError)
    return (
      <div className="load-error">
        <Logo />
        <h1>Lernhefte konnten nicht geladen werden</h1>
        <p>
          Inkloop konnte den lokalen Speicher nicht öffnen. Bestehende Daten
          wurden nicht überschrieben.
        </p>
        <p className="muted">{loadError}</p>
        <button
          className="secondary"
          onClick={async () => {
            try {
              const raw = await readStoredData();
              if (!raw) throw new Error();
              download(
                new Blob([JSON.stringify(raw)], { type: "application/json" }),
                "inkloop-notfallsicherung.json",
              );
            } catch {
              setLoadError(
                "Auch die Notfallsicherung konnte nicht gelesen werden. Bitte Website-Daten nicht löschen.",
              );
            }
          }}
        >
          Vorhandene Daten als Notfallsicherung laden
        </button>
        <button className="primary" onClick={() => location.reload()}>
          Erneut versuchen
        </button>
        <p className="muted">
          Bitte Safari regulär öffnen und prüfen, ob Website-Speicher verfügbar
          ist.
        </p>
      </div>
    );
  if (!data || !notebook || !page)
    return (
      <div className="loading">
        <LoaderCircle className="spin" size={24} />
        <span>Lernhefte werden geladen</span>
      </div>
    );
  const currentChatUrl =
    data.settings.provider === "chatgpt"
      ? notebook.chatUrl
      : notebook.claudeUrl;
  const pageIndex = notebook.pages.findIndex((p) => p.id === page.id),
    h = history.current.get(page.id);
  void historyVersion;
  return (
    <>
      <input
        type="file"
        accept="application/json,.json"
        ref={importFile}
        hidden
        onChange={(e) => restore(e.target.files?.[0])}
      />
      {inLibrary ? (
        <main className="library">
          <header className="library-top">
            <div className="library-brand">
              <Logo /> Inkloop
            </div>
            <div className="topbar-actions">
              <IconButton label="Deine Handschrift" onClick={startProfile}>
                <Fingerprint size={20} />
              </IconButton>
              <IconButton
                label="Einstellungen"
                onClick={() => open("settings")}
              >
                <Settings2 size={20} />
              </IconButton>
            </div>
          </header>
          {(saving === "error" || externalEdit) && (
            <div className="error-banner" role="alert">
              {externalEdit
                ? "Änderungen in einem anderen Fenster."
                : "Speichern fehlgeschlagen."}
              <button onClick={externalEdit ? () => location.reload() : backup}>
                {externalEdit ? "Neu laden" : "Sicherung herunterladen"}
              </button>
            </div>
          )}
          <div className="library-content">
            <div className="library-heading">
              <h1>Lernhefte</h1>
              <button
                className="primary"
                onClick={() => {
                  setNewName("");
                  open("newNotebook");
                }}
              >
                <Plus size={17} /> Neues Lernheft
              </button>
            </div>
            <ul className="library-list" aria-label="Lernhefte">
              {data.notebooks.map((n) => (
                <li key={n.id}>
                  <button
                    className="library-notebook"
                    aria-label={n.name}
                    onClick={() => openNotebook(n)}
                  >
                    <span className="library-book">
                      <BookOpen size={23} strokeWidth={1.6} />
                    </span>
                    <span className="library-name">
                      <span>{n.name}</span>
                      <small>
                        {n.pages.length}{" "}
                        {n.pages.length === 1 ? "Seite" : "Seiten"}
                      </small>
                    </span>
                    <ChevronRight className="library-arrow" size={18} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </main>
      ) : (
        <>
          {sidebar && (
            <>
              <button
                className="sidebar-scrim"
                aria-label="Seiten schliessen"
                onClick={() => setSidebar(false)}
              />
              <aside className="sidebar visible" aria-label="Seiten">
                <div className="drawer-heading">
                  <h2>Seiten</h2>
                  <IconButton
                    label="Schliessen"
                    onClick={() => setSidebar(false)}
                  >
                    <X size={20} />
                  </IconButton>
                </div>
                <div className="pages-list">
                  {notebook.pages.map((p, i) => (
                    <button
                      className={`page-link ${p.id === page.id ? "selected" : ""}`}
                      key={p.id}
                      onClick={() => {
                        navigatePage(p.id);
                        setSidebar(false);
                      }}
                    >
                      <span className="page-thumb">
                        <Miniature strokes={p.strokes} />
                        <span>{String(i + 1).padStart(2, "0")}</span>
                      </span>
                      <span className="page-link-label">{p.title}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="text-button new-page"
                  onClick={() => addPage()}
                >
                  <Plus size={16} /> Neue Seite
                </button>
              </aside>
            </>
          )}
          <main className="app-main">
            <header className="topbar">
              <div className="editor-navigation">
                <button
                  className="icon-button"
                  aria-label="Alle Lernhefte"
                  onClick={openLibrary}
                >
                  <Library size={20} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Seiten"
                  aria-expanded={sidebar}
                  onClick={() => setSidebar(!sidebar)}
                >
                  <PanelLeft size={20} />
                </button>
                <span className="editor-notebook" title={notebook.name}>
                  {notebook.name}
                </span>
              </div>
              <div className="topbar-actions">
                <span
                  role="status"
                  className={`save-state ${saving === "error" ? "error" : ""}`}
                  title={saving === "saved" ? "Gespeichert" : "Speicherstatus"}
                >
                  {saving === "saving" ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : saving === "error" ? (
                    <HelpCircle size={16} />
                  ) : (
                    <CheckCheck size={17} />
                  )}
                  <span className="visually-hidden">
                    {saving === "saving"
                      ? "Wird gespeichert"
                      : saving === "error"
                        ? "Nicht gespeichert"
                        : "Gespeichert"}
                  </span>
                </span>
                <button
                  className="panel-toggle secondary"
                  aria-label="Lernbereich"
                  aria-expanded={panelOpen}
                  aria-controls="learning-panel"
                  ref={panelToggle}
                  onClick={() =>
                    panelOpen ? closeLearningPanel() : setPanelOpen(true)
                  }
                >
                  <FileText size={17} />
                  <span>Lernbereich</span>
                </button>
                <button
                  className="primary submit-button"
                  aria-label="Antwort abgeben"
                  disabled={!page.strokes.length || busy || externalEdit}
                  onClick={prepareSubmission}
                >
                  {busy ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ArrowUpRight size={17} />
                  )}
                  {bridgeReady && data.settings.provider === "chatgpt"
                    ? "An ChatGPT"
                    : "Abgeben"}
                </button>
              </div>
            </header>
            {(saving === "error" || externalEdit) && (
              <div className="error-banner">
                {externalEdit
                  ? "Inkloop wurde in einem anderen Fenster geändert. Lade diese Seite neu, bevor du weiterschreibst."
                  : `Speichern fehlgeschlagen. ${saveError} Bitte eine Sicherung herunterladen.`}
                <button
                  onClick={externalEdit ? () => location.reload() : backup}
                >
                  {externalEdit ? "Neu laden" : "Sicherung herunterladen"}
                </button>
              </div>
            )}
            <div
              className={`workspace ${panelOpen ? "" : "panel-hidden"}`}
              inert={externalEdit}
            >
              <section
                className="writing-area"
                aria-label="Lernheft"
                inert={sidebar || (compact && panelOpen)}
              >
                <div className="page-heading">
                  <div>
                    <input
                      className="page-title"
                      value={page.title}
                      maxLength={150}
                      aria-label="Seitentitel"
                      onChange={(e) => patchPage({ title: e.target.value })}
                    />
                    <div className="page-subtitle">
                      <button
                        onClick={() =>
                          patchNotebook({
                            language: notebook.language === "de" ? "en" : "de",
                          })
                        }
                        title="Sprache des KI-Feedbacks wechseln"
                      >
                        {notebook.language === "de" ? "Deutsch" : "English"}{" "}
                        <ChevronDown size={12} />
                      </button>
                    </div>
                  </div>
                  <IconButton
                    label="Seitenoptionen"
                    onClick={() => open("pageMenu")}
                  >
                    <MoreHorizontal size={23} />
                  </IconButton>
                </div>
                <div className="canvas-shell">
                  <div
                    className="ink-toolbar"
                    role="toolbar"
                    aria-label="Schreibwerkzeuge"
                  >
                    <div className="toolbar-group">
                      <IconButton
                        label="Stift"
                        active={tool === "pen"}
                        onClick={() => setTool("pen")}
                      >
                        <PenLine size={20} />
                      </IconButton>
                      <IconButton
                        label="Textmarker"
                        active={tool === "marker"}
                        onClick={() => setTool("marker")}
                      >
                        <Highlighter size={20} />
                      </IconButton>
                      <IconButton
                        label="Radierer"
                        active={tool === "eraser"}
                        onClick={() => setTool("eraser")}
                      >
                        <Eraser size={20} />
                      </IconButton>
                      <IconButton
                        label="Gerade Linie"
                        active={tool === "line"}
                        onClick={() => setTool("line")}
                      >
                        <Minus size={20} />
                      </IconButton>
                    </div>
                    <span className="toolbar-divider" />
                    <div className="ink-colors" aria-label="Stiftfarbe">
                      {palette.map((c) => (
                        <button
                          key={c}
                          className={`color-button ${c === color ? "selected" : ""}`}
                          style={{ "--ink": c } as React.CSSProperties}
                          aria-label={`Farbe ${c}`}
                          aria-pressed={c === color}
                          onClick={() => {
                            setColor(c);
                            if (tool === "eraser") setTool("pen");
                          }}
                        />
                      ))}
                    </div>
                    <span className="toolbar-divider" />
                    <button
                      className="width-button"
                      aria-label={`Strichbreite ${width}. Zum Wechseln tippen.`}
                      onClick={() =>
                        setWidth(width === 2.5 ? 4 : width === 4 ? 1.5 : 2.5)
                      }
                    >
                      <span
                        style={{ height: width * 1.5, width: width * 1.5 }}
                      />
                    </button>
                    <span className="toolbar-divider" />
                    <IconButton
                      label="Rückgängig"
                      disabled={!h?.past.length}
                      onClick={() => undo()}
                    >
                      <Undo2 size={18} />
                    </IconButton>
                    <IconButton
                      label="Wiederholen"
                      disabled={!h?.future.length}
                      onClick={() => undo(true)}
                    >
                      <Redo2 size={18} />
                    </IconButton>
                  </div>
                  <div className="paper-scroll" key={page.id}>
                    <div className="paper-holder">
                      <InkCanvas
                        key={page.id}
                        strokes={page.strokes}
                        onChange={changeInk}
                        tool={tool}
                        color={color}
                        width={width}
                        touchWriting={data.settings.touchWriting}
                        paper={page.paper}
                        zoom={zoom}
                      />
                    </div>
                  </div>
                  <div className="canvas-footer">
                    <div className="paper-controls">
                      <IconButton
                        label="Verkleinern"
                        disabled={zoom <= 1}
                        onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
                      >
                        <ZoomOut size={15} />
                      </IconButton>
                      <span>{Math.round(zoom * 100)} %</span>
                      <IconButton
                        label="Vergrößern"
                        disabled={zoom >= 2}
                        onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                      >
                        <ZoomIn size={15} />
                      </IconButton>
                      <span className="tiny-divider" />
                      <select
                        aria-label="Papierart"
                        value={page.paper}
                        onChange={(e) =>
                          patchPage({ paper: e.target.value as Page["paper"] })
                        }
                      >
                        <option value="grid">Kariert</option>
                        <option value="ruled">Liniert</option>
                        <option value="dots">Punkte</option>
                        <option value="blank">Blanko</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="writing-bottom">
                  <div>
                    <IconButton
                      label="Vorherige Seite"
                      disabled={pageIndex === 0}
                      onClick={() =>
                        navigatePage(notebook.pages[pageIndex - 1].id)
                      }
                    >
                      <ChevronLeft size={17} />
                    </IconButton>
                    <span>
                      {pageIndex + 1} / {notebook.pages.length}
                    </span>
                    <IconButton
                      label="Nächste Seite"
                      disabled={pageIndex === notebook.pages.length - 1}
                      onClick={() =>
                        navigatePage(notebook.pages[pageIndex + 1].id)
                      }
                    >
                      <ChevronRight size={17} />
                    </IconButton>
                  </div>
                </div>
              </section>
              {(compact || panelOpen) && (
                <>
                  {compact && (
                    <button
                      className="panel-scrim"
                      aria-label="Lernbereich schliessen"
                      disabled={!panelOpen}
                      aria-hidden={!panelOpen}
                      tabIndex={-1}
                      onClick={closeLearningPanel}
                    />
                  )}
                  <aside
                    id="learning-panel"
                    ref={learningPanel}
                    className="learning-panel"
                    aria-label="Lernbereich"
                    aria-hidden={!panelOpen}
                    inert={sidebar || !panelOpen}
                  >
                    <div
                      className="panel-tabs"
                      role="tablist"
                      aria-label="Lernansicht"
                      onKeyDown={(e) => {
                        if (
                          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            e.key,
                          )
                        )
                          return;
                        e.preventDefault();
                        const tabs = ["task", "text", "feedback"] as const;
                        const i = tabs.indexOf(tab);
                        const next =
                          tabs[
                            e.key === "Home"
                              ? 0
                              : e.key === "End"
                                ? 2
                                : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3
                          ];
                        setTab(next);
                        document.getElementById(`tab-${next}`)?.focus();
                      }}
                    >
                      {(["task", "text", "feedback"] as const).map((t, i) => (
                        <button
                          key={t}
                          id={`tab-${t}`}
                          role="tab"
                          aria-selected={tab === t}
                          tabIndex={tab === t ? 0 : -1}
                          aria-controls="learning-content"
                          className={tab === t ? "selected" : ""}
                          onClick={() => setTab(t)}
                        >
                          {["Aufgabe", "Abschrift", "Feedback"][i]}
                          {((t === "task" && page.task) ||
                            (t === "text" && submission?.transcription) ||
                            (t === "feedback" && submission?.feedback)) && (
                            <span />
                          )}
                        </button>
                      ))}
                    </div>
                    <div
                      className="panel-content"
                      id="learning-content"
                      role="tabpanel"
                      aria-labelledby={`tab-${tab}`}
                    >
                      {tab === "task" &&
                        (page.task ? (
                          <div className="task-content">
                            <RichText text={page.task} />
                            <button
                              className="text-button small"
                              onClick={() => open("task", page.task)}
                            >
                              <PenLine size={14} /> Bearbeiten
                            </button>
                          </div>
                        ) : (
                          <div className="panel-empty">
                            <p>Keine Aufgabe</p>
                            <button
                              className="secondary"
                              onClick={() => open("task")}
                            >
                              <Plus size={16} /> Aufgabe einfügen
                            </button>
                          </div>
                        ))}
                      {tab === "text" &&
                        (submission?.transcription ? (
                          <>
                            <div className="section-label">
                              Abschrift{" "}
                              <button
                                aria-label="Abschrift kopieren"
                                onClick={() =>
                                  copyText(submission.transcription)
                                }
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                            <RichText text={submission.transcription} />
                            <details className="edit-details">
                              <summary>Abschrift korrigieren</summary>
                              <textarea
                                aria-label="Abschrift korrigieren"
                                maxLength={MAX_TEXT_LENGTH}
                                value={submission.transcription}
                                onChange={(e) =>
                                  editSubmission({
                                    transcription: e.target.value.slice(
                                      0,
                                      MAX_TEXT_LENGTH,
                                    ),
                                  })
                                }
                              />
                              <small>
                                Deine Korrektur wird lokal gespeichert.
                              </small>
                            </details>
                          </>
                        ) : (
                          <div className="panel-empty">
                            <p>Keine Abschrift</p>
                            <button
                              className="secondary"
                              onClick={() => open("import")}
                            >
                              <ArrowDownToLine size={16} /> KI-Antwort
                              übernehmen
                            </button>
                          </div>
                        ))}
                      {tab === "feedback" &&
                        (submission?.feedback ? (
                          <>
                            <div className="section-label">
                              Feedback{" "}
                              <button
                                aria-label="Feedback kopieren"
                                onClick={() => copyText(submission.feedback)}
                              >
                                <Copy size={14} />
                              </button>
                            </div>
                            <RichText text={submission.feedback} />
                            {submission.nextTask && (
                              <div className="next-task">
                                <span className="eyebrow">Nächste Aufgabe</span>
                                <RichText text={submission.nextTask} />
                                <button
                                  className="secondary"
                                  onClick={() => {
                                    addPage(submission.nextTask);
                                    setTab("task");
                                  }}
                                >
                                  <Plus size={16} /> Auf neuer Seite lösen
                                </button>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="panel-empty">
                            <p>Kein Feedback</p>
                            <button
                              className="secondary"
                              onClick={() => open("import")}
                            >
                              <ArrowDownToLine size={16} /> KI-Antwort
                              übernehmen
                            </button>
                          </div>
                        ))}
                      {page.submissions.length > 0 && (
                        <div className="submission-history">
                          <label htmlFor="submission-select">
                            Abgaben auf dieser Seite
                          </label>
                          <select
                            id="submission-select"
                            value={submission?.id || ""}
                            onChange={(e) =>
                              setSelectedSubmission(e.target.value)
                            }
                          >
                            {[...page.submissions].reverse().map((s, i) => (
                              <option value={s.id} key={s.id}>
                                Abgabe {page.submissions.length - i} ·{" "}
                                {new Date(s.createdAt).toLocaleTimeString(
                                  "de-CH",
                                  {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )}
                                {s.feedback ? " · mit Antwort" : ""}
                              </option>
                            ))}
                          </select>
                          {submission &&
                            data.settings.provider === "chatgpt" && (
                              <>
                                <small>
                                  {submission.handoff?.sent
                                    ? "Für ChatGPT bereitgestellt"
                                    : submission.handoff
                                      ? "Lokal gespeichert"
                                      : "Sendestatus unbekannt"}
                                </small>
                                <button
                                  className="text-button small"
                                  disabled={busy}
                                  onClick={() =>
                                    void showHandoff(
                                      notebook,
                                      page.id,
                                      submission,
                                      submission.handoff ?? {
                                        subject: notebook.subject,
                                        language: notebook.language,
                                        samples: [],
                                        sent: false,
                                      },
                                      !submission.handoff?.sent,
                                    )
                                  }
                                >
                                  {submission.handoff?.sent
                                    ? "Übergabe öffnen"
                                    : "Erneut an ChatGPT senden"}
                                </button>
                              </>
                            )}
                          <button
                            className="text-button small"
                            onClick={() => open("import")}
                          >
                            <ArrowDownToLine size={14} /> Antwort zu dieser
                            Abgabe übernehmen
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="panel-bottom">
                      <div className="chat-choice">
                        <span className="section-label">Chat</span>
                        <select
                          aria-label="KI-Anbieter"
                          value={data.settings.provider}
                          onChange={(e) =>
                            setData({
                              ...data,
                              settings: {
                                ...data.settings,
                                provider: e.target.value as
                                  "chatgpt" | "claude",
                              },
                            })
                          }
                        >
                          <option value="chatgpt">ChatGPT</option>
                          <option value="claude">Claude</option>
                        </select>
                      </div>
                      <button
                        className="chat-link text-button small"
                        onClick={() => open("settings")}
                      >
                        <Link2 size={13} />
                        {currentChatUrl ? "Chat ändern" : "Chat verknüpfen"}
                      </button>
                    </div>
                  </aside>
                </>
              )}
            </div>
          </main>
        </>
      )}
      {sheet === "profile" && (
        <Modal
          title={`Handschriftprobe ${profileStep + 1} von ${sampleLabels.length}`}
          onClose={close}
          wide
        >
          <p className="muted">
            Schreibe die Vorgabe ab. Beim Abgeben kannst du die Proben als
            Lesehilfe mitsenden.
          </p>
          <div className="profile-progress">
            {sampleLabels.map((_, i) => (
              <span key={i} className={i <= profileStep ? "done" : ""} />
            ))}
          </div>
          <div className="sample-target">{sampleLabels[profileStep]}</div>
          <div className="sample-surface">
            <InkCanvas
              key={profileStep}
              strokes={sampleInk}
              onChange={setSampleInk}
              tool="pen"
              color={palette[0]}
              width={2.5}
              touchWriting={profileFinger}
              paper="ruled"
              label="Handschriftprobe"
            />
          </div>
          <div className="sample-actions">
            <label>
              <input
                type="checkbox"
                checked={profileFinger}
                onChange={(e) => setProfileFinger(e.target.checked)}
              />{" "}
              Mit Finger schreiben
            </label>
            <button
              className="text-button small"
              onClick={() => setSampleInk([])}
            >
              <Eraser size={14} /> Neu schreiben
            </button>
          </div>
          <button
            className="primary full"
            disabled={!sampleInk.length}
            onClick={() => {
              const samples = [
                ...profileDraft,
                {
                  id: uid(),
                  label: sampleLabels[profileStep],
                  strokes: sampleInk,
                },
              ];
              if (profileStep < sampleLabels.length - 1) {
                setProfileDraft(samples);
                setProfileStep(profileStep + 1);
                setSampleInk([]);
              } else {
                setData({ ...data, samples, onboardingDone: true });
                close();
                notify("Dein Schriftprofil ist gespeichert.");
              }
            }}
          >
            {profileStep === sampleLabels.length - 1
              ? "Schriftprofil speichern"
              : "Nächste Probe"}
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {sheet === "newNotebook" && (
        <Modal title="Neues Lernheft" onClose={close}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const n = newNotebook(newName.trim());
              setData({
                ...data,
                notebooks: [...data.notebooks, n],
                activeNotebook: n.id,
                activePage: n.pages[0].id,
              });
              setInLibrary(false);
              setTab("task");
              setSelectedSubmission(null);
              setZoom(1);
              setPanelOpen(!prefersCompactLayout());
              close();
            }}
          >
            <label className="field-label" htmlFor="notebook-name">
              Name oder Fach
            </label>
            <input
              autoFocus
              id="notebook-name"
              className="text-input"
              maxLength={150}
              placeholder="Z. B. Französisch"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              className="primary full"
              disabled={!newName.trim()}
              type="submit"
            >
              <Plus size={17} /> Lernheft erstellen
            </button>
          </form>
        </Modal>
      )}
      {sheet === "task" && (
        <Modal title="Aufgabe" onClose={close}>
          <textarea
            autoFocus
            className="large-textarea"
            placeholder="Aufgabe hier einfügen …"
            value={draft}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="primary full"
            onClick={() => {
              patchPage({ task: draft.trim() });
              setTab("task");
              close();
            }}
          >
            Aufgabe speichern <Check size={17} />
          </button>
        </Modal>
      )}
      {sheet === "submit" && prepared && (
        <Modal title="Abgabe" onClose={close} wide>
          {prepared.shared && (
            <div className="plugin-handoff">
              <div>
                <Sparkles size={20} />
                <h3>Für ChatGPT bereit</h3>
              </div>
              <p>
                Kopiere den Auftrag in deinen Chat mit aktivem Inkloop Plugin.
              </p>
              <button
                className="primary"
                onClick={() =>
                  copyText(
                    `Lies meine Inkloop-Abgabe ${prepared.submission.id} mit dem Inkloop-Plugin. Transkribiere die Handschrift originalgetreu, gib anschließend Lernfeedback und speichere beides mit inkloop_write_response zurück. Nutze den Kontext unseres bisherigen Chats.`,
                  )
                }
              >
                <Copy size={15} /> Auftrag für ChatGPT kopieren
              </button>
            </div>
          )}
          <details className="manual-handoff" open={!prepared.shared}>
            <summary>Bild und Anweisung</summary>
            <div className="handoff-layout">
              <a
                href={prepared.url}
                download={fileName}
                className="submission-preview"
              >
                <img
                  src={prepared.url}
                  alt="Deine handschriftliche Antwort mit optionalen Schriftreferenzen"
                />
                <span>
                  Deine Antwort als PNG <Download size={14} />
                </span>
              </a>
              <div className="handoff-steps">
                <div className="handoff-step">
                  <div>
                    <div className="button-row">
                      <button
                        className="secondary"
                        onClick={async () => {
                          try {
                            if (
                              !navigator.clipboard?.write ||
                              typeof ClipboardItem === "undefined"
                            )
                              throw new Error();
                            await navigator.clipboard.write([
                              new ClipboardItem({ "image/png": prepared.blob }),
                            ]);
                            notify("Bild kopiert. Im Chat einfügen.");
                          } catch {
                            setError(
                              "Bildkopieren wird hier nicht unterstützt. Nutze „Teilen“ oder „Speichern“ und hänge das Bild im Chat an.",
                            );
                          }
                        }}
                      >
                        <Copy size={15} /> Bild kopieren
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          const file = new File([prepared.blob], fileName, {
                            type: "image/png",
                          });
                          if (navigator.canShare?.({ files: [file] })) {
                            navigator
                              .share({
                                files: [file],
                                title: "Inkloop – Meine Lösung",
                              })
                              .catch((e) => {
                                if (e.name !== "AbortError")
                                  setError(
                                    "Teilen fehlgeschlagen. Speichere das Bild und hänge es im Chat an.",
                                  );
                              });
                          } else {
                            download(prepared.blob, fileName);
                            notify("Bild wird heruntergeladen.");
                          }
                        }}
                      >
                        <Upload size={15} /> Teilen
                      </button>
                    </div>
                  </div>
                </div>
                <div className="handoff-step">
                  <div>
                    <button
                      className="secondary"
                      onClick={() => copyText(prepared.prompt)}
                    >
                      <Copy size={15} /> Anweisung kopieren
                    </button>
                    <details className="prompt-details">
                      <summary>Anweisung ansehen / manuell kopieren</summary>
                      <textarea
                        aria-label="Anweisung für deinen Chat"
                        readOnly
                        value={prepared.prompt}
                      />
                    </details>
                  </div>
                </div>
              </div>
            </div>
          </details>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="handoff-footer">
            <a
              className="primary"
              href={chatLink(currentChatUrl, data.settings.provider)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Chat öffnen <ExternalLink size={15} />
            </a>
            <button
              className="secondary"
              onClick={() => {
                setPrepared(null);
                open("import");
              }}
            >
              <ArrowDownToLine size={16} /> KI-Antwort übernehmen
            </button>
          </div>
        </Modal>
      )}
      {sheet === "import" && (
        <Modal title="Antwort übernehmen" onClose={close}>
          <p className="muted">
            Füge die Antwort aus deinem Chat ein. Klartext wird als Feedback
            gespeichert.
          </p>
          {submission && (
            <div className="import-target">
              Zu Abgabe vom{" "}
              {new Date(submission.createdAt).toLocaleString("de-CH", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </div>
          )}
          <textarea
            autoFocus
            className="large-textarea"
            aria-label="KI-Antwort"
            placeholder={
              '{"transcription": "…", "feedback": "…", "next_task": "…"}'
            }
            value={draft}
            maxLength={MAX_TEXT_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
          />
          {error && <p className="inline-error">{error}</p>}
          <button
            className="primary full"
            disabled={!draft.trim()}
            onClick={applyResponse}
          >
            <ArrowDownToLine size={17} /> Im Lernheft speichern
          </button>
        </Modal>
      )}
      {sheet === "settings" && (
        <Modal title="Einstellungen" onClose={close}>
          {error === "restore-confirm" ? (
            <>
              <div className="info-note">
                <Upload size={20} />
                <span>
                  Die Sicherung ersetzt deine Lernhefte und Schriftproben auf
                  diesem Gerät.
                </span>
              </div>
              <button className="secondary full" onClick={backup}>
                <Download size={16} /> Aktuelle Daten zuerst sichern
              </button>
              <button
                className="primary full"
                onClick={() => {
                  try {
                    if (!restoreCandidate.current) return;
                    setData(restoreCandidate.current);
                    history.current.clear();
                    setSelectedSubmission(null);
                    close();
                    notify("Sicherung wiederhergestellt.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Durch Sicherung ersetzen
              </button>
            </>
          ) : (
            <>
              <div className="settings-section">
                <h3>Schreiben</h3>
                <label className="setting-row">
                  <span>
                    Auch mit dem Finger schreiben
                    <small>
                      Aus: Finger zum Scrollen, Pencil zum Schreiben.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={data.settings.touchWriting}
                    onChange={(e) =>
                      setData({
                        ...data,
                        settings: {
                          ...data.settings,
                          touchWriting: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
                <label className="setting-row">
                  <span>
                    Schriftprofil bei Abgabe mitsenden
                    <small>
                      {data.samples.length} beschriftete Referenzen im
                      Seitenbild.
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={data.settings.includeProfile}
                    onChange={(e) =>
                      setData({
                        ...data,
                        settings: {
                          ...data.settings,
                          includeProfile: e.target.checked,
                        },
                      })
                    }
                  />
                </label>
              </div>
              <div className="settings-section">
                <h3>Chat für {notebook.name}</h3>
                <ChatForm
                  key={data.settings.provider}
                  initial={currentChatUrl}
                  provider={data.settings.provider}
                  onSave={(url) => {
                    patchNotebook(
                      data.settings.provider === "chatgpt"
                        ? { chatUrl: url }
                        : { claudeUrl: url },
                    );
                    notify("Chat-Link gespeichert.");
                  }}
                />
              </div>
              <div className="settings-section">
                <h3>ChatGPT-Plugin</h3>
                <p className="muted">
                  {bridgeReady
                    ? "Verbunden. Aktiviere Inkloop in deinem Chat."
                    : "Derzeit getrennt. Du kannst Bilder manuell teilen."}
                </p>
                <p className="small muted">
                  Nutze dasselbe Konto. Geteilte Abgaben und Rückmeldungen
                  liegen privat auf dem Server.
                </p>
              </div>
              <div className="settings-section">
                <h3>Deine Daten</h3>
                <p className="muted">
                  Lernhefte liegen lokal. Safari und die installierte App können
                  getrennte Speicher nutzen.
                </p>
                <div className="button-row">
                  <button className="secondary" onClick={backup}>
                    <Download size={15} /> Sicherung herunterladen
                  </button>
                  <button
                    className="secondary"
                    onClick={() => importFile.current?.click()}
                  >
                    <Upload size={15} /> Wiederherstellen
                  </button>
                </div>
                <button
                  className="text-button small"
                  onClick={async () => {
                    try {
                      const granted = await navigator.storage?.persist?.();
                      notify(
                        granted
                          ? "Dauerhafter Speicher ist aktiviert."
                          : "Safari verwaltet den Speicher. Bitte weiterhin Sicherungen erstellen.",
                      );
                    } catch {
                      notify("Bitte regelmäßig Sicherungen erstellen.");
                    }
                  }}
                >
                  <ShieldCheck size={14} /> Dauerhaften Speicher anfragen
                </button>
              </div>
              <button className="secondary full" onClick={() => open("help")}>
                <HelpCircle size={16} /> Installation & Hilfe
              </button>
            </>
          )}
        </Modal>
      )}
      {sheet === "pageMenu" && (
        <Modal title="Seitenoptionen" onClose={close}>
          <button
            className="menu-action"
            onClick={() => {
              const p = {
                ...structuredClone(page),
                id: uid(),
                title: page.title.slice(0, 142) + " – Kopie",
                submissions: [],
                updatedAt: Date.now(),
              };
              patchNotebook({ pages: [...notebook.pages, p] });
              navigatePage(p.id);
              close();
            }}
          >
            <Copy size={18} />
            <span>
              Seite duplizieren
              <small>Handschrift und Aufgabe übernehmen.</small>
            </span>
          </button>
          <button
            className="menu-action"
            disabled={!page.strokes.length}
            onClick={async () => {
              setBusy(true);
              try {
                const s: Submission = {
                  id: uid(),
                  createdAt: Date.now(),
                  strokes: page.strokes,
                  task: page.task,
                  transcription: "",
                  feedback: "",
                  nextTask: "",
                };
                const b = await submissionImage(notebook, s, []);
                download(b, fileName);
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Download size={18} />
            <span>
              Handschrift als Bild speichern
              <small>Gut lesbares PNG auf weißem Papier.</small>
            </span>
          </button>
          <button
            className="menu-action"
            disabled={!page.strokes.length}
            onClick={() => {
              changeInk([]);
              close();
              notify("Seite geleert. Mit Rückgängig wiederherstellbar.");
            }}
          >
            <Eraser size={18} />
            <span>
              Handschrift leeren
              <small>Kannst du anschließend rückgängig machen.</small>
            </span>
          </button>
          <details className="danger-details">
            <summary>
              <Trash2 size={16} /> Seite löschen
            </summary>
            <p>Beim lokalen Löschen bleiben geteilte Abgaben auf dem Server.</p>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => void deletePage(false)}
              >
                Nur auf diesem Gerät löschen
              </button>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void deletePage(true)}
              >
                Seite und Serverkopien löschen
              </button>
            </div>
          </details>
          {error && <p className="inline-error">{error}</p>}
        </Modal>
      )}
      {sheet === "help" && (
        <Modal title="Installation und Hilfe" onClose={close}>
          <div className="help-section">
            <span className="step-number">1</span>
            <div>
              <h3>Zum Home-Bildschirm</h3>
              <p>
                Öffne Inkloop in Safari. Tippe auf Teilen, dann auf „Zum
                Home-Bildschirm“. Öffne Inkloop danach über das neue Symbol.
                Nach dem ersten vollständigen Laden funktioniert das Lernheft
                auch offline.
              </p>
            </div>
          </div>
          <div className="help-section">
            <span className="step-number">2</span>
            <div>
              <h3>Chat daneben öffnen</h3>
              <p>
                Nutze den iPad-Fenstermodus oder Split View für Inkloop und
                deinen Chat. Aufgaben kopierst du ins Lernheft. Mit „Antwort
                abgeben“ bereitest du Bild und Anweisung vor.
              </p>
            </div>
          </div>
          <div className="help-section">
            <span className="step-number">3</span>
            <div>
              <h3>Bild und Antwort übertragen</h3>
              <p>
                Füge Bild und Anweisung in deinen bestehenden Chat ein. Falls
                Bildkopieren nicht unterstützt wird, speichere das PNG und hänge
                es dort an. Die Antwort kopierst du mit „KI-Antwort übernehmen“
                zurück.
              </p>
            </div>
          </div>
          <div className="info-note">
            <CircleCheck size={20} />
            <span>
              Inkloop ruft keine kostenpflichtige KI-API auf. Die normalen
              Nachrichten- und Upload-Limits deines Abos gelten weiterhin. Mit
              dem Inkloop-Plugin kann ChatGPT abgegebene Seiten lesen, Aufgaben
              senden und Antworten zurückschreiben. Du startest den Auftrag in
              deinem Original-Chat. Ohne Plugin und bei Claude nutzt du die
              Bildübergabe.
            </span>
          </div>
          <details className="help-detail">
            <summary>Was bedeutet das Schriftprofil?</summary>
            <p>
              Deine vier beschrifteten Proben werden auf Wunsch unter dem
              Antwortbild ergänzt. Die KI kann sie zum Vergleichen nutzen. Das
              ist kein Modelltraining, keine Garantie für perfekte Erkennung und
              kann die Bildgröße erhöhen.
            </p>
          </details>
          <details className="help-detail">
            <summary>Formeln, Tabellen und Mindmaps</summary>
            <p>
              Das Originalbild bewahrt alle Positionen und Verbindungen. Die
              Anweisung fordert die KI auf, Formeln, Tabellen und Beziehungen zu
              erhalten und Unklarheiten zu markieren. Prüfe besonders
              Vorzeichen, Zahlen und Soll/Haben-Spalten.
            </p>
          </details>
          <details className="help-detail">
            <summary>Schreiben und Speichern</summary>
            <p>
              Standardmäßig schreibt nur Pencil oder Maus. Finger scrollen. Für
              Fingereingabe aktiviere die Option in den Einstellungen. Der
              Radierer entfernt ganze Striche. Vergrößern hilft bei kleinen
              Zeichen. Inkloop speichert nach jedem abgeschlossenen Strich.
              Sichere deine Lernhefte regelmäßig als JSON-Datei.
            </p>
          </details>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </>
  );
}

function ChatForm({
  initial,
  provider,
  onSave,
}: {
  initial: string;
  provider: "chatgpt" | "claude";
  onSave: (url: string) => void;
}) {
  const [value, setValue] = useState(initial),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          if (value.trim()) {
            const url = new URL(chatLink(value, provider));
            if (
              (provider === "chatgpt" && url.hostname === "claude.ai") ||
              (provider === "claude" && url.hostname !== "claude.ai")
            )
              throw new Error(
                "Bitte einen Link zum ausgewählten Anbieter verwenden. Den Anbieter wechselst du im Lernbereich.",
              );
          }
          onSave(value.trim());
          setError("");
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <input
        className="text-input"
        aria-label="Link zum bestehenden Chat"
        value={value}
        maxLength={2000}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://chatgpt.com/c/… oder https://claude.ai/chat/…"
      />
      <button className="secondary" type="submit">
        <Link2 size={15} /> Chat-Link speichern
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
function RichText({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="rich-text">{text}</div>}>
      <MarkdownText text={text} />
    </Suspense>
  );
}
