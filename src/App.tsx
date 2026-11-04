import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  CheckCheck,
  ChevronLeft,
  CircleAlert,
  Eraser,
  FileText,
  Highlighter,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PenLine,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import {
  publishSubmission,
  deleteSharedPage,
  hostedWorkspace,
  type BridgeEvent,
} from "./bridge";
import { useLiquidChrome } from "./useLiquidChrome";
import InkCanvas, { type Tool } from "./Canvas";
import {
  type Notebook,
  type Page,
  type Stroke,
  type Submission,
  newNotebook,
  newPage,
  uid,
  buildPrompt,
  parseBackup,
  type AppData,
} from "./model";
import { readStoredData, download } from "./storage";
import { submissionImage, displayInkColor } from "./ink";
import {
  IconButton,
  Logo,
  Miniature,
  Toast,
  dismissModal,
  type ToastMessage,
} from "./ui";
import { usePersistence } from "./usePersistence";
import { useBridgeSync, workspaceKeyOf } from "./useBridgeSync";
import {
  applyBridgeEvents,
  bridgeNews,
  mapNotebook,
  mapPage,
  mapSubmission,
} from "./updates";
import { Library } from "./Library";
import { LearningPanel, type PanelTab } from "./LearningPanel";
import {
  DeleteNotebookSheet,
  HelpSheet,
  ImportSheet,
  INK_PALETTE,
  NewNotebookSheet,
  PageMenuSheet,
  ProfileSheet,
  SettingsSheet,
  SubmitSheet,
  TaskSheet,
  type Prepared,
} from "./Sheets";

const compactLayout =
  "(max-width: 720px), (orientation: portrait) and (max-width: 1180px)";
const prefersCompactLayout = () => window.matchMedia(compactLayout).matches;
type Sheet =
  | "profile"
  | "settings"
  | "newNotebook"
  | "task"
  | "submit"
  | "help"
  | "pageMenu"
  | "deleteNotebook"
  | "import"
  | null;

/** True once `active` has stayed true for `ms`, so quick work shows no spinner. */
function useDelayed(active: boolean, ms: number) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return shown;
}

export default function App() {
  const store = usePersistence();
  const { data, setData, current, externalEdit, saving } = store;
  const [accountChanged, setAccountChanged] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null),
    [inLibrary, setInLibrary] = useState(true),
    [sidebar, setSidebar] = useState(false),
    [compact, setCompact] = useState(prefersCompactLayout),
    [panelOpen, setPanelOpen] = useState(false),
    [tab, setTab] = useState<PanelTab>("task"),
    [tool, setTool] = useState<Tool>("pen"),
    [color, setColor] = useState(INK_PALETTE[0]),
    [width, setWidth] = useState(2.5),
    [zoom, setZoom] = useState(1),
    [turn, setTurn] = useState<-1 | 0 | 1>(0);
  const [toast, setToast] = useState<ToastMessage | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notebookToDelete, setNotebookToDelete] = useState<string | null>(null),
    [prepared, setPrepared] = useState<Prepared | null>(null),
    [selectedSubmission, setSelectedSubmission] = useState<string | null>(null),
    [restoring, setRestoring] = useState(false),
    [historyVersion, setHistoryVersion] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    history = useRef(
      new Map<string, { past: Stroke[][]; future: Stroke[][] }>(),
    ),
    importFile = useRef<HTMLInputElement>(null),
    restoreCandidate = useRef<AppData | null>(null),
    glassToolbar = useRef<HTMLDivElement>(null),
    glassActions = useRef<HTMLDivElement>(null),
    panelToggle = useRef<HTMLButtonElement>(null),
    learningPanel = useRef<HTMLElement>(null),
    sheetToken = useRef(0);

  const theme = data?.settings.theme ?? "dark";
  const light = theme === "light";
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const background = window
      .getComputedStyle(root)
      .getPropertyValue("--bg")
      .trim();
    if (background)
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", background);
  }, [theme]);
  useLiquidChrome(
    glassToolbar,
    glassActions,
    Boolean(data) && !inLibrary && !store.loadError,
  );

  const notify = useCallback(
    (
      message: string,
      kind: ToastMessage["kind"] = "success",
      action?: ToastMessage["action"],
    ) => {
      setToast({ id: Date.now(), message, kind, action });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(
        () => setToast(null),
        action ? 7000 : kind === "error" ? 6000 : 4000,
      );
    },
    [],
  );
  useEffect(() => () => clearTimeout(toastTimer.current), []);

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
  useEffect(() => {
    const query = window.matchMedia(compactLayout);
    const update = () => {
      setCompact(query.matches);
      setPanelOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!prepared) return;
    return () => URL.revokeObjectURL(prepared.url);
  }, [prepared]);

  const onBridgeEvents = useCallback(
    (events: BridgeEvent[], cursor: string) => {
      const known = current.current;
      if (!known || known.bridgeCursor === cursor) return;
      const { responses, tasks } = bridgeNews(known, events);
      setData((old) => old && applyBridgeEvents(old, events, cursor));
      const active = responses.find((e) => e.pageId === known.activePage);
      const showFeedback = () => {
        setInLibrary(false);
        setTab("feedback");
        setPanelOpen(true);
      };
      if (active) {
        setSelectedSubmission(active.submissionId ?? null);
        setTab("feedback");
      }
      if (responses.length)
        notify(
          responses.length === 1
            ? "Neues Feedback aus dem Chat ist da."
            : `${responses.length} neue Feedbacks aus dem Chat sind da.`,
          "info",
          active ? { label: "Ansehen", run: showFeedback } : undefined,
        );
      else if (tasks.length)
        notify(
          tasks.length === 1
            ? "Neue Aufgabe aus dem Chat ist da."
            : `${tasks.length} neue Aufgaben aus dem Chat sind da.`,
          "info",
        );
    },
    [current, setData, notify],
  );
  const bridgeReady = useBridgeSync({
    current,
    loaded: !!data,
    paused: externalEdit || accountChanged,
    workspaceKey: workspaceKeyOf(data),
    onEvents: onBridgeEvents,
    onAccountChanged: () => setAccountChanged(true),
  });
  const showSpinner = useDelayed(saving === "saving", 900);

  const notebook = data?.notebooks.find((n) => n.id === data.activeNotebook),
    page = notebook?.pages.find((p) => p.id === data?.activePage);
  const submission =
    page?.submissions.find((s) => s.id === selectedSubmission) ||
    page?.submissions.at(-1);
  const plugin = bridgeReady && data?.settings.provider === "chatgpt";

  const update = (fn: (d: AppData) => AppData) =>
    setData((d) => (d ? fn(d) : d));
  const patchNotebook = (patch: Partial<Notebook>) =>
    update((d) =>
      mapNotebook(d, d.activeNotebook, (n) => ({ ...n, ...patch })),
    );
  const patchPage = (patch: Partial<Page>) =>
    update((d) =>
      mapPage(d, d.activeNotebook, d.activePage, (p) => ({
        ...p,
        ...patch,
        updatedAt: Date.now(),
      })),
    );
  const patchSettings = (patch: Partial<AppData["settings"]>) =>
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const changeInk = (strokes: Stroke[]) => {
    if (!page || !notebook || externalEdit) return;
    store.strokeEnded();
    const h = history.current.get(page.id) || { past: [], future: [] };
    h.past.push(page.strokes);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    history.current.set(page.id, h);
    setHistoryVersion((v) => v + 1);
    update((d) =>
      mapPage(d, notebook.id, page.id, (p) => ({
        ...p,
        strokes,
        updatedAt: Date.now(),
      })),
    );
  };
  const undo = (redo = false) => {
    // Read the live page so delayed callers (a toast action) stay correct.
    const d = current.current;
    const live = d?.notebooks
      .find((n) => n.id === d.activeNotebook)
      ?.pages.find((p) => p.id === d.activePage);
    if (!live) return;
    const h = history.current.get(live.id);
    const strokes = (redo ? h?.future : h?.past)?.pop();
    if (!h || !strokes) return;
    (redo ? h.past : h.future).push(live.strokes);
    patchPage({ strokes });
    setHistoryVersion((v) => v + 1);
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

  const open = (s: Sheet) => {
    sheetToken.current++;
    setError("");
    setSheet(s);
  };
  /** Closes `which` (default: the open sheet) unless another one replaced it. */
  const closeSheet = (which: Sheet = sheet) => {
    const token = sheetToken.current;
    dismissModal(() =>
      setSheet((s) => {
        if (s !== which || sheetToken.current !== token) return s;
        if (which === "submit") setPrepared(null);
        if (which === "settings") {
          restoreCandidate.current = null;
          setRestoring(false);
        }
        setError("");
        return null;
      }),
    );
  };
  const close = () => {
    if (!busy) closeSheet();
  };
  const resetPageView = () => {
    setSelectedSubmission(null);
    setTab("task");
    setZoom(1);
  };
  const openNotebook = (n: Notebook) => {
    update((d) => {
      if (d.activeNotebook === n.id) return d;
      const last = n.pages.find((p) => p.id === n.lastPageId);
      return {
        ...d,
        activeNotebook: n.id,
        activePage: last?.id ?? n.pages[0].id,
      };
    });
    if (data?.activeNotebook !== n.id) resetPageView();
    setTurn(0);
    setSidebar(false);
    setPanelOpen(false);
    setInLibrary(false);
  };
  const navigatePage = (id: string, direction: -1 | 0 | 1 = 0) => {
    setTurn(direction);
    update((d) => ({
      ...mapNotebook(d, d.activeNotebook, (n) => ({ ...n, lastPageId: id })),
      activePage: id,
    }));
    resetPageView();
  };
  const addPage = (task = "") => {
    if (!notebook) return;
    const p = { ...newPage(`Seite ${notebook.pages.length + 1}`), task };
    update((d) => ({
      ...mapNotebook(d, d.activeNotebook, (n) => ({
        ...n,
        pages: [...n.pages, p],
        lastPageId: p.id,
      })),
      activePage: p.id,
    }));
    resetPageView();
    setTurn(1);
    setSidebar(false);
  };
  const notebookForDeletion = data?.notebooks.find(
    (n) => n.id === notebookToDelete,
  );
  const deleteNotebook = () => {
    if (!notebookForDeletion || externalEdit) return;
    const doomed = notebookForDeletion;
    update((d) => {
      const notebooks = d.notebooks.filter((n) => n.id !== doomed.id);
      if (d.activeNotebook !== doomed.id) return { ...d, notebooks };
      const next = notebooks[0];
      return {
        ...d,
        notebooks,
        activeNotebook: next?.id ?? "",
        activePage:
          next?.pages.find((p) => p.id === next.lastPageId)?.id ??
          next?.pages[0].id ??
          "",
      };
    });
    for (const p of doomed.pages) history.current.delete(p.id);
    setNotebookToDelete(null);
    close();
    notify("Lernheft auf diesem Gerät gelöscht.");
  };
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify("In die Zwischenablage kopiert.");
      return true;
    } catch {
      notify("Kopieren nicht verfügbar.", "error");
      return false;
    }
  };
  const markSent = (n: Notebook, pageId: string, s: Submission) =>
    update((d) =>
      mapPage(d, n.id, pageId, (p) => ({
        ...p,
        submissions: p.submissions.map((x) =>
          x.id === s.id && x.handoff
            ? { ...x, handoff: { ...x.handoff, sent: true } }
            : x,
        ),
      })),
    );
  const showHandoff = async (
    n: Notebook,
    pageId: string,
    s: Submission,
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
      const blob = await submissionImage(source, s, handoff.samples);
      const prompt = buildPrompt(source, s, handoff.samples.length);
      let shared = handoff.sent;
      if (send) {
        try {
          await publishSubmission(source, pageId, s, blob, prompt);
          shared = true;
          markSent(n, pageId, s);
        } catch {
          notify(
            "Senden fehlgeschlagen. Du kannst es bei dieser Abgabe erneut versuchen.",
            "error",
          );
        }
      }
      if (send && shared) {
        notify("Abgabe gespeichert.");
        return;
      }
      if (current.current?.activePage === pageId) {
        setPrepared({
          blob,
          url: URL.createObjectURL(blob),
          prompt,
          submission: s,
          shared,
        });
        setSelectedSubmission(s.id);
        sheetToken.current++;
        setSheet("submit");
      }
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "Das Abgabebild konnte nicht erstellt werden.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const prepareSubmission = () => {
    if (!data || !notebook || !page || !page.strokes.length || busy) return;
    if (externalEdit) return;
    const handoff = {
      subject: notebook.subject,
      language: page.language ?? notebook.language,
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
    void showHandoff(notebook, page.id, s, handoff, !!plugin);
  };
  const applyResponse = (result: {
    transcription: string;
    feedback: string;
    nextTask: string;
  }) => {
    if (!page || !notebook) return;
    if (submission) {
      update((d) =>
        mapSubmission(d, page.id, submission.id, (s) => ({ ...s, ...result })),
      );
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
    setTab(result.feedback ? "feedback" : "text");
    setPanelOpen(true);
    close();
    notify("Antwort im Lernheft gespeichert.");
  };
  const deletePage = async (includeServer: boolean) => {
    if (!notebook || !page || busy || externalEdit) return;
    setBusy(true);
    setError("");
    try {
      if (includeServer)
        await deleteSharedPage(
          page.id,
          page.submissions.map((s) => s.id),
        );
      update((d) => {
        const target = d.notebooks.find((n) => n.id === notebook.id);
        const index = target?.pages.findIndex((p) => p.id === page.id) ?? -1;
        if (!target || index < 0) return d;
        const pages = target.pages.filter((p) => p.id !== page.id);
        if (!pages.length) pages.push(newPage("Seite 1"));
        const replacement = pages[Math.max(0, index - 1)].id;
        return {
          ...mapNotebook(d, target.id, (n) => ({
            ...n,
            pages,
            lastPageId: n.lastPageId === page.id ? replacement : n.lastPageId,
          })),
          activePage: d.activePage === page.id ? replacement : d.activePage,
        };
      });
      history.current.delete(page.id);
      resetPageView();
      setBusy(false);
      closeSheet("pageMenu");
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
    try {
      restoreCandidate.current = parseBackup(await file.text());
      setRestoring(true);
      open("settings");
    } catch (e) {
      notify((e as Error).message, "error");
    }
    if (importFile.current) importFile.current.value = "";
  };
  const fileName = `inkloop-${notebook?.subject.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "antwort"}.png`;

  if (store.accountRequired || accountChanged) {
    return (
      <main className="load-error">
        <Logo />
        <h1>Inkloop</h1>
        <p>
          {accountChanged
            ? "Das ChatGPT-Konto wurde gewechselt."
            : "Melde dich mit deinem ChatGPT-Konto an."}
        </p>
        <a
          className="primary"
          href={accountChanged ? "/" : "/signin-with-chatgpt?return_to=%2F"}
          target="_top"
        >
          {accountChanged ? "Inkloop neu öffnen" : "Mit ChatGPT anmelden"}
        </a>
      </main>
    );
  }
  if (store.loadError)
    return (
      <div className="load-error">
        <Logo />
        <h1>Lernhefte konnten nicht geladen werden</h1>
        <p>
          Inkloop konnte den lokalen Speicher nicht öffnen. Bestehende Daten
          wurden nicht überschrieben.
        </p>
        <p className="muted">{store.loadError}</p>
        <button
          className="secondary"
          onClick={async () => {
            try {
              if (!store.workspace.current) return;
              const raw = await readStoredData(store.workspace.current);
              if (!raw) throw new Error();
              download(
                new Blob([JSON.stringify(raw)], { type: "application/json" }),
                "inkloop-notfallsicherung.json",
              );
            } catch {
              store.setLoadError(
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
  if (!data)
    return (
      <div className="loading">
        <LoaderCircle className="spin" size={24} />
        <span>Lernhefte werden geladen</span>
      </div>
    );

  const chatUrl =
    data.settings.provider === "chatgpt"
      ? (notebook?.chatUrl ?? "")
      : (notebook?.claudeUrl ?? "");
  const h = page ? history.current.get(page.id) : undefined;
  void historyVersion;
  const banner = (saving === "error" || externalEdit) && (
    <div className="error-banner" role="alert">
      <CircleAlert size={17} aria-hidden="true" />
      <span>
        {externalEdit
          ? "Inkloop wurde in einem anderen Fenster geändert. Lade neu, bevor du weiterschreibst."
          : `Speichern fehlgeschlagen. ${store.saveError} Bitte eine Sicherung herunterladen.`}
      </span>
      <button onClick={externalEdit ? () => location.reload() : backup}>
        {externalEdit ? "Neu laden" : "Sicherung herunterladen"}
      </button>
    </div>
  );
  const turnPage = (direction: -1 | 1) => {
    if (!notebook || !page) return;
    const index = notebook.pages.findIndex((p) => p.id === page.id);
    const target = notebook.pages[index + direction];
    if (target) navigatePage(target.id, direction);
    else notify(direction < 0 ? "Erste Seite" : "Letzte Seite", "info");
  };

  return (
    <>
      <input
        type="file"
        accept="application/json,.json"
        ref={importFile}
        hidden
        onChange={(e) => restore(e.target.files?.[0])}
      />
      {inLibrary || !notebook || !page ? (
        <Library
          data={data}
          notebook={notebook}
          page={page}
          light={light}
          banner={banner}
          locked={externalEdit}
          onOpen={openNotebook}
          onCreate={() => open("newNotebook")}
          onOptions={(n) => {
            setNotebookToDelete(n.id);
            open("deleteNotebook");
          }}
          onProfile={() => open("profile")}
          onSettings={() => open("settings")}
        />
      ) : (
        <>
          <button
            className={`sidebar-scrim ${sidebar ? "visible" : ""}`}
            aria-label="Seiten schliessen"
            tabIndex={-1}
            aria-hidden={!sidebar}
            onClick={() => setSidebar(false)}
          />
          <aside
            className={`sidebar ${sidebar ? "visible" : ""}`}
            aria-label="Seiten"
            aria-hidden={!sidebar}
            inert={!sidebar}
          >
            <div className="drawer-heading">
              <h2>Seiten</h2>
              <IconButton
                label="Seitenleiste schliessen"
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
                  aria-current={p.id === page.id ? "page" : undefined}
                  onClick={() => {
                    const from = notebook.pages.findIndex(
                      (x) => x.id === page.id,
                    );
                    if (p.id !== page.id) navigatePage(p.id, i > from ? 1 : -1);
                    setSidebar(false);
                  }}
                >
                  <span className="page-thumb">
                    <Miniature
                      strokes={p.strokes}
                      light={light}
                      live={sidebar}
                    />
                    <span>{String(i + 1).padStart(2, "0")}</span>
                  </span>
                  <span className="page-link-label">
                    {p.title}
                    {p.submissions.some((s) => s.feedback) && (
                      <small>Mit Feedback</small>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <button className="text-button new-page" onClick={() => addPage()}>
              <Plus size={16} /> Neue Seite
            </button>
          </aside>
          <main className="app-main">
            <header className="topbar">
              <div className="editor-navigation">
                <button
                  className="icon-button library-back"
                  aria-label="Alle Lernhefte"
                  onClick={() => {
                    setSidebar(false);
                    setInLibrary(true);
                  }}
                >
                  <ChevronLeft size={20} />
                  <span>Lernhefte</span>
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
                  <small>
                    {page.title} ·{" "}
                    {notebook.pages.findIndex((p) => p.id === page.id) + 1}/
                    {notebook.pages.length}
                  </small>
                </span>
              </div>
              <div className="editor-tools">
                <div
                  className="ink-toolbar liquid-ui"
                  ref={glassToolbar}
                  role="toolbar"
                  aria-label="Schreibwerkzeuge"
                  inert={sidebar || externalEdit || (compact && panelOpen)}
                >
                  <div className="toolbar-group">
                    {(
                      [
                        ["pen", "Stift", PenLine],
                        ["marker", "Textmarker", Highlighter],
                        ["eraser", "Radierer", Eraser],
                        ["line", "Gerade Linie", Minus],
                      ] as const
                    ).map(([t, label, Icon]) => (
                      <IconButton
                        key={t}
                        label={label}
                        active={tool === t}
                        onClick={() => setTool(t)}
                      >
                        <Icon size={20} />
                      </IconButton>
                    ))}
                  </div>
                  <span className="toolbar-divider" />
                  <div className="ink-colors" aria-label="Stiftfarbe">
                    {INK_PALETTE.map((c, i) => (
                      <button
                        key={c}
                        className={`color-button ${c === color ? "selected" : ""}`}
                        style={
                          {
                            "--ink": displayInkColor(c, light),
                          } as CSSProperties
                        }
                        aria-label={`Farbe ${["Hell", "Grau", "Blau"][i]}`}
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
                    <span style={{ height: width * 1.5, width: width * 1.5 }} />
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
                <IconButton
                  label="Seitenoptionen"
                  onClick={() => open("pageMenu")}
                  disabled={externalEdit || sidebar || (compact && panelOpen)}
                >
                  <MoreHorizontal size={22} />
                </IconButton>
              </div>
              <div className="topbar-actions liquid-ui" ref={glassActions}>
                <span
                  role="status"
                  className={`save-state ${saving === "error" ? "error" : ""}`}
                  title={saving === "saved" ? "Gespeichert" : "Speicherstatus"}
                >
                  {saving === "error" ? (
                    <CircleAlert size={16} />
                  ) : showSpinner ? (
                    <LoaderCircle size={16} className="spin" />
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
                  className={`panel-toggle secondary ${submission?.feedback ? "has-feedback" : ""}`}
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
                  {plugin ? "An ChatGPT" : "Abgeben"}
                </button>
              </div>
            </header>
            {banner}
            <div
              className={`workspace ${panelOpen ? "" : "panel-hidden"}`}
              inert={externalEdit}
            >
              <section
                className="writing-area"
                aria-label="Lernheft"
                inert={sidebar || (compact && panelOpen)}
              >
                <div className="canvas-shell">
                  <div
                    className={`paper-scroll ${turn ? `turn-${turn > 0 ? "next" : "previous"}` : ""}`}
                    key={page.id}
                  >
                    <div className="paper-holder">
                      <InkCanvas
                        key={page.id}
                        strokes={page.strokes}
                        onChange={changeInk}
                        onStrokeActive={store.strokeActivity}
                        tool={tool}
                        color={color}
                        light={light}
                        width={width}
                        onPageSwipe={turnPage}
                        paper={page.paper}
                        zoom={zoom}
                      />
                    </div>
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
                  <LearningPanel
                    panelRef={learningPanel}
                    data={data}
                    page={page}
                    submission={submission}
                    tab={tab}
                    open={panelOpen}
                    inert={sidebar || !panelOpen}
                    busy={busy}
                    chatLinked={!!chatUrl}
                    connected={!!plugin}
                    onTab={setTab}
                    onEditTask={() => open("task")}
                    onImport={() => open("import")}
                    onCopy={(text) => void copyText(text)}
                    onEditSubmission={(patch) =>
                      submission &&
                      update((d) =>
                        mapSubmission(d, page.id, submission.id, (s) => ({
                          ...s,
                          ...patch,
                        })),
                      )
                    }
                    onSolveNext={(task) => addPage(task)}
                    onSelectSubmission={setSelectedSubmission}
                    onHandoff={(s) =>
                      void showHandoff(
                        notebook,
                        page.id,
                        s,
                        s.handoff ?? {
                          subject: notebook.subject,
                          language: page.language ?? notebook.language,
                          samples: [],
                          sent: false,
                        },
                        !s.handoff?.sent,
                      )
                    }
                    onProvider={(provider) => patchSettings({ provider })}
                    onLinkChat={() => open("settings")}
                  />
                </>
              )}
            </div>
          </main>
        </>
      )}
      {sheet === "profile" && (
        <ProfileSheet
          light={light}
          onClose={close}
          onSave={(samples) => {
            update((d) => ({ ...d, samples, onboardingDone: true }));
            close();
            notify("Dein Schriftprofil ist gespeichert.");
          }}
        />
      )}
      {sheet === "newNotebook" && (
        <NewNotebookSheet
          onClose={close}
          onCreate={(name) => {
            const n = newNotebook(name);
            update((d) => ({
              ...d,
              notebooks: [...d.notebooks, n],
              activeNotebook: n.id,
              activePage: n.pages[0].id,
            }));
            setInLibrary(false);
            resetPageView();
            setPanelOpen(false);
            close();
          }}
        />
      )}
      {sheet === "deleteNotebook" && notebookForDeletion && (
        <DeleteNotebookSheet
          notebook={notebookForDeletion}
          locked={externalEdit}
          onClose={close}
          onDelete={deleteNotebook}
        />
      )}
      {sheet === "task" && page && (
        <TaskSheet
          initial={page.task}
          onClose={close}
          onSave={(task) => {
            patchPage({ task });
            setTab("task");
            close();
          }}
        />
      )}
      {sheet === "import" && (
        <ImportSheet
          submission={submission}
          onClose={close}
          onApply={applyResponse}
        />
      )}
      {sheet === "submit" && prepared && (
        <SubmitSheet
          prepared={prepared}
          notebook={notebook}
          provider={data.settings.provider}
          chatUrl={chatUrl}
          fileName={fileName}
          onClose={close}
          notify={notify}
          copyText={copyText}
        />
      )}
      {sheet === "settings" && (
        <SettingsSheet
          data={data}
          notebook={notebook}
          chatUrl={chatUrl}
          restoring={restoring}
          hosted={hostedWorkspace}
          locked={externalEdit}
          bridgeReady={bridgeReady}
          onClose={close}
          onSettings={patchSettings}
          onSaveChat={(url) => {
            patchNotebook(
              data.settings.provider === "chatgpt"
                ? { chatUrl: url }
                : { claudeUrl: url },
            );
            notify("Chat-Link gespeichert.");
          }}
          onBackup={backup}
          onPickRestore={() => importFile.current?.click()}
          onConfirmRestore={() => {
            if (!restoreCandidate.current) return;
            setData(restoreCandidate.current);
            history.current.clear();
            resetPageView();
            close();
            notify("Sicherung wiederhergestellt.");
          }}
          onHelp={() => open("help")}
          notify={notify}
        />
      )}
      {sheet === "pageMenu" && notebook && page && (
        <PageMenuSheet
          notebook={notebook}
          page={page}
          zoom={zoom}
          busy={busy}
          error={error}
          onClose={close}
          onZoom={setZoom}
          onPatch={patchPage}
          onDuplicate={() => {
            const p = {
              ...structuredClone(page),
              id: uid(),
              title: page.title.slice(0, 142) + " – Kopie",
              submissions: [],
              updatedAt: Date.now(),
            };
            patchNotebook({ pages: [...notebook.pages, p] });
            navigatePage(p.id, 1);
            close();
          }}
          onSaveImage={async () => {
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
              download(await submissionImage(notebook, s, []), fileName);
              setBusy(false);
              closeSheet("pageMenu");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          onClear={() => {
            changeInk([]);
            close();
            notify("Seite geleert.", "info", {
              label: "Rückgängig",
              run: () => undo(),
            });
          }}
          onDelete={(includeServer) => void deletePage(includeServer)}
        />
      )}
      {sheet === "help" && <HelpSheet onClose={close} />}
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
