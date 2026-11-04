import { useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleCheck,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  HelpCircle,
  Link2,
  Plus,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import InkCanvas from "./Canvas";
import {
  chatLink,
  MAX_TEXT_LENGTH,
  parseResponse,
  uid,
  type AppData,
  type Notebook,
  type Page,
  type Sample,
  type Stroke,
  type Submission,
} from "./model";
import { download } from "./storage";
import { IconButton, Modal } from "./ui";

export const INK_PALETTE = ["#f4f5f7", "#a9abb2", "#3976e8"];
const SAMPLE_LABELS = [
  "a g q y z · b d p · m n u · I l 1",
  "0 O · 1 7 · 2 Z · 5 S · 8 B · 6 9",
  "x² + 3x = 12 · ½ · −4,75 · CHF 1’250.00",
  "Soll / Haben · Aufwand / Ertrag · The quick brown fox.",
];

export function ProfileSheet({
  light,
  onClose,
  onSave,
}: {
  light: boolean;
  onClose: () => void;
  onSave: (samples: Sample[]) => void;
}) {
  const [step, setStep] = useState(0),
    [ink, setInk] = useState<Stroke[]>([]),
    [undo, setUndo] = useState<Stroke[] | null>(null),
    [draft, setDraft] = useState<Sample[]>([]);
  const last = step === SAMPLE_LABELS.length - 1;
  return (
    <Modal
      title={`Handschriftprobe ${step + 1} von ${SAMPLE_LABELS.length}`}
      onClose={onClose}
      wide
    >
      <p className="muted">
        Schreibe die Vorgabe ab. Beim Abgeben kannst du die Proben als Lesehilfe
        mitsenden.
      </p>
      <div className="profile-progress">
        {SAMPLE_LABELS.map((_, i) => (
          <span key={i} className={i <= step ? "done" : ""} />
        ))}
      </div>
      <div className="sample-target">{SAMPLE_LABELS[step]}</div>
      <div className="sample-surface">
        <InkCanvas
          key={step}
          strokes={ink}
          onChange={(next) => {
            setUndo(ink);
            setInk(next);
          }}
          tool="pen"
          color={INK_PALETTE[0]}
          light={light}
          width={2.5}
          paper="ruled"
          label="Handschriftprobe"
        />
      </div>
      <div className="sample-actions">
        <IconButton
          label="Probe rückgängig"
          disabled={!undo}
          onClick={() => {
            if (undo) setInk(undo);
            setUndo(null);
          }}
        >
          <Undo2 size={16} />
        </IconButton>
        <button
          className="text-button small"
          onClick={() => {
            setUndo(ink);
            setInk([]);
          }}
        >
          <Eraser size={14} /> Neu schreiben
        </button>
      </div>
      <button
        className="primary full"
        disabled={!ink.length}
        onClick={() => {
          const samples = [
            ...draft,
            { id: uid(), label: SAMPLE_LABELS[step], strokes: ink },
          ];
          if (!last) {
            setDraft(samples);
            setStep(step + 1);
            setInk([]);
            setUndo(null);
          } else onSave(samples);
        }}
      >
        {last ? "Schriftprofil speichern" : "Nächste Probe"}
        <ArrowRight size={16} />
      </button>
    </Modal>
  );
}

export function NewNotebookSheet({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal title="Neues Lernheft" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim());
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
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary full" disabled={!name.trim()} type="submit">
          <Plus size={17} /> Lernheft erstellen
        </button>
      </form>
    </Modal>
  );
}

export function DeleteNotebookSheet({
  notebook,
  locked,
  onClose,
  onDelete,
}: {
  notebook: Notebook;
  locked: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <Modal title="Lernheft löschen?" onClose={onClose}>
      <p>
        «{notebook.name}» und alle seine Seiten werden auf diesem Gerät
        gelöscht. Bereits geteilte Abgaben bleiben auf dem Server.
      </p>
      <div className="button-row">
        <button className="secondary" autoFocus onClick={onClose}>
          Abbrechen
        </button>
        <button className="danger-button" disabled={locked} onClick={onDelete}>
          Lernheft löschen
        </button>
      </div>
    </Modal>
  );
}

export function TaskSheet({
  initial,
  onClose,
  onSave,
}: {
  initial: string;
  onClose: () => void;
  onSave: (task: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Modal title="Aufgabe" onClose={onClose}>
      <textarea
        autoFocus
        className="large-textarea"
        placeholder="Aufgabe hier einfügen …"
        value={draft}
        maxLength={MAX_TEXT_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="primary full" onClick={() => onSave(draft.trim())}>
        Aufgabe speichern <Check size={17} />
      </button>
    </Modal>
  );
}

export function ImportSheet({
  submission,
  onClose,
  onApply,
}: {
  submission?: Submission;
  onClose: () => void;
  onApply: (result: ReturnType<typeof parseResponse>) => void;
}) {
  const [draft, setDraft] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title="Antwort übernehmen" onClose={onClose}>
      <p className="muted">
        Füge die Antwort aus deinem Chat ein. Den JSON-Block teilt Inkloop in
        Abschrift, Feedback und nächste Aufgabe auf. Normaler Text wird als
        Feedback gespeichert.
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
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary full"
        disabled={!draft.trim()}
        onClick={() => {
          try {
            onApply(parseResponse(draft));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <ArrowDownToLine size={17} /> Im Lernheft speichern
      </button>
    </Modal>
  );
}

export type Prepared = {
  blob: Blob;
  url: string;
  prompt: string;
  submission: Submission;
  shared: boolean;
};

export function SubmitSheet({
  prepared,
  notebook,
  provider,
  chatUrl,
  fileName,
  onClose,
  notify,
  copyText,
}: {
  prepared: Prepared;
  notebook?: Notebook;
  provider: AppData["settings"]["provider"];
  chatUrl: string;
  fileName: string;
  onClose: () => void;
  notify: (message: string) => void;
  copyText: (text: string) => Promise<boolean>;
}) {
  const [step, setStep] = useState<"copy" | "open" | "manual">("copy"),
    [error, setError] = useState("");
  const pluginPrompt = `Lies meine Inkloop-Abgabe ${prepared.submission.id} mit dem Inkloop-Plugin. Transkribiere die Handschrift originalgetreu, gib anschliessend Lernfeedback und speichere beides mit inkloop_write_response zurück. Nutze den Kontext unseres Chats.`;
  const copy = async (text: string) => {
    const ok = await copyText(text);
    setError(
      ok
        ? ""
        : "Kopieren nicht verfügbar. Markiere den Text und kopiere ihn manuell.",
    );
    return ok;
  };
  return (
    <Modal
      title={prepared.shared ? "Abgabe in ChatGPT" : "Abgabe"}
      onClose={onClose}
      wide
    >
      {prepared.shared && (
        <div className="plugin-handoff">
          <ol className="handoff-progress" aria-label="Fortschritt">
            <li className="done">Abgegeben</li>
            <li className={step === "copy" ? "current" : "done"}>
              Auftrag kopiert
            </li>
            <li className={step === "copy" ? "" : "current"}>Im Chat senden</li>
          </ol>
          <p role="status">
            {step === "copy"
              ? "Die Seite ist bereit. Kopiere den Auftrag und sende ihn in deinem Chat."
              : "Setze den Auftrag in deinen Chat mit Inkloop ein und sende ihn ab. Das Feedback erscheint danach im Lernbereich."}
          </p>
          {step === "copy" ? (
            <button
              className="primary"
              onClick={async () =>
                setStep((await copy(pluginPrompt)) ? "open" : "manual")
              }
            >
              <Copy size={15} /> Auftrag kopieren
            </button>
          ) : (
            <>
              {step === "manual" && (
                <textarea
                  className="large-textarea"
                  aria-label="Auftrag für ChatGPT"
                  value={pluginPrompt}
                  readOnly
                />
              )}
              <a
                className="primary"
                href={chatLink(notebook?.chatUrl ?? "", "chatgpt")}
                target="_blank"
                rel="noopener noreferrer"
              >
                {notebook?.chatUrl
                  ? "Verknüpften Chat öffnen"
                  : "ChatGPT öffnen"}
                <ExternalLink size={15} />
              </a>
              <button
                className="text-button small"
                onClick={async () => {
                  if (await copy(pluginPrompt)) setStep("open");
                }}
              >
                Auftrag erneut kopieren
              </button>
            </>
          )}
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
                        "Bildkopieren wird hier nicht unterstützt. Nutze «Teilen» oder «Speichern» und hänge das Bild im Chat an.",
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
            <div className="handoff-step">
              <button
                className="secondary"
                onClick={() => void copy(prepared.prompt)}
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
      </details>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {!prepared.shared && (
        <div className="handoff-footer">
          <a
            className="primary"
            href={chatLink(chatUrl, provider)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat öffnen <ExternalLink size={15} />
          </a>
        </div>
      )}
    </Modal>
  );
}

function ChatForm({
  initial,
  provider,
  onSave,
}: {
  initial: string;
  provider: AppData["settings"]["provider"];
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

export function SettingsSheet({
  data,
  notebook,
  chatUrl,
  restoring,
  hosted,
  locked,
  bridgeReady,
  onClose,
  onSettings,
  onSaveChat,
  onBackup,
  onPickRestore,
  onConfirmRestore,
  onHelp,
  notify,
}: {
  data: AppData;
  notebook?: Notebook;
  chatUrl: string;
  restoring: boolean;
  hosted: boolean;
  locked: boolean;
  bridgeReady: boolean;
  onClose: () => void;
  onSettings: (patch: Partial<AppData["settings"]>) => void;
  onSaveChat: (url: string) => void;
  onBackup: () => void;
  onPickRestore: () => void;
  onConfirmRestore: () => void;
  onHelp: () => void;
  notify: (message: string) => void;
}) {
  return (
    <Modal title="Einstellungen" onClose={onClose}>
      {restoring ? (
        <>
          <div className="info-note">
            <Upload size={20} />
            <span>
              Die Sicherung ersetzt deine Lernhefte und Schriftproben auf diesem
              Gerät.
            </span>
          </div>
          <button className="secondary full" onClick={onBackup}>
            <Download size={16} /> Aktuelle Daten zuerst sichern
          </button>
          <button className="primary full" onClick={onConfirmRestore}>
            Durch Sicherung ersetzen
          </button>
        </>
      ) : (
        <>
          {hosted && (
            <div className="settings-section">
              <a
                className="secondary"
                href="/signout-with-chatgpt?return_to=%2F"
                target="_top"
              >
                Abmelden
              </a>
            </div>
          )}
          <div className="settings-section">
            <label className="setting-row appearance-row">
              <span>Darstellung</span>
              <select
                aria-label="Darstellung"
                value={data.settings.theme ?? "dark"}
                disabled={locked}
                onChange={(e) =>
                  onSettings({
                    theme: e.target.value === "light" ? "light" : "dark",
                  })
                }
              >
                <option value="dark">Dunkel</option>
                <option value="light">Hell</option>
              </select>
            </label>
          </div>
          <div className="settings-section">
            <h3>Schreiben</h3>
            <label className="setting-row">
              <span>
                Schriftprofil bei Abgabe mitsenden
                <small>
                  {data.samples.length} beschriftete Referenzen im Seitenbild.
                </small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={data.settings.includeProfile}
                onChange={(e) =>
                  onSettings({ includeProfile: e.target.checked })
                }
              />
            </label>
          </div>
          {notebook && (
            <div className="settings-section">
              <h3>Chat für {notebook.name}</h3>
              <ChatForm
                key={data.settings.provider}
                initial={chatUrl}
                provider={data.settings.provider}
                onSave={onSaveChat}
              />
            </div>
          )}
          <div className="settings-section">
            <h3>ChatGPT-Plugin</h3>
            <p className="muted">
              <span
                className={`status-dot ${bridgeReady ? "on" : ""}`}
                aria-hidden="true"
              />
              {bridgeReady
                ? "Verbunden. Aktiviere Inkloop in deinem Chat."
                : "Derzeit getrennt. Du kannst Bilder manuell teilen."}
            </p>
            <p className="small muted">
              Nutze dasselbe Konto. Geteilte Abgaben und Rückmeldungen liegen
              privat auf dem Server.
            </p>
          </div>
          <div className="settings-section">
            <h3>Deine Daten</h3>
            <p className="muted">
              Lernhefte liegen lokal. Safari und die installierte App können
              getrennte Speicher nutzen.
            </p>
            <div className="button-row">
              <button className="secondary" onClick={onBackup}>
                <Download size={15} /> Sicherung herunterladen
              </button>
              <button className="secondary" onClick={onPickRestore}>
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
                  notify("Bitte regelmässig Sicherungen erstellen.");
                }
              }}
            >
              <ShieldCheck size={14} /> Dauerhaften Speicher anfragen
            </button>
          </div>
          <button className="secondary full" onClick={onHelp}>
            <HelpCircle size={16} /> Installation & Hilfe
          </button>
        </>
      )}
    </Modal>
  );
}

export function PageMenuSheet({
  notebook,
  page,
  zoom,
  busy,
  error,
  onClose,
  onZoom,
  onPatch,
  onDuplicate,
  onSaveImage,
  onClear,
  onDelete,
}: {
  notebook: Notebook;
  page: Page;
  zoom: number;
  busy: boolean;
  error: string;
  onClose: () => void;
  onZoom: (zoom: number) => void;
  onPatch: (patch: Partial<Page>) => void;
  onDuplicate: () => void;
  onSaveImage: () => void;
  onClear: () => void;
  onDelete: (includeServer: boolean) => void;
}) {
  return (
    <Modal title="Seitenoptionen" onClose={onClose}>
      <label className="field-label">
        Seitentitel
        <input
          className="text-input page-title"
          value={page.title}
          maxLength={150}
          aria-label="Seitentitel"
          onChange={(e) => onPatch({ title: e.target.value })}
        />
      </label>
      <div className="page-settings">
        <label>
          Sprache
          <select
            aria-label="Seitensprache"
            value={page.language ?? notebook.language}
            onChange={(e) =>
              onPatch({ language: e.target.value as Page["language"] })
            }
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          Papier
          <select
            aria-label="Papierart"
            value={page.paper}
            onChange={(e) =>
              onPatch({ paper: e.target.value as Page["paper"] })
            }
          >
            <option value="grid">Kariert</option>
            <option value="ruled">Liniert</option>
            <option value="dots">Punkte</option>
            <option value="blank">Blanko</option>
          </select>
        </label>
        <div className="paper-controls" role="group" aria-label="Zoom">
          <IconButton
            label="Verkleinern"
            disabled={zoom <= 1}
            onClick={() => onZoom(Math.max(1, zoom - 0.25))}
          >
            <ZoomOut size={15} />
          </IconButton>
          <span>{Math.round(zoom * 100)} %</span>
          <IconButton
            label="Vergrössern"
            disabled={zoom >= 2}
            onClick={() => onZoom(Math.min(2, zoom + 0.25))}
          >
            <ZoomIn size={15} />
          </IconButton>
        </div>
      </div>
      <button className="menu-action" onClick={onDuplicate}>
        <Copy size={18} />
        <span>
          Seite duplizieren
          <small>Handschrift und Aufgabe übernehmen.</small>
        </span>
      </button>
      <button
        className="menu-action"
        disabled={!page.strokes.length || busy}
        onClick={onSaveImage}
      >
        <Download size={18} />
        <span>
          Handschrift als Bild speichern
          <small>Gut lesbares PNG auf weissem Papier.</small>
        </span>
      </button>
      <button
        className="menu-action"
        disabled={!page.strokes.length}
        onClick={onClear}
      >
        <Eraser size={18} />
        <span>
          Handschrift leeren
          <small>Kannst du anschliessend rückgängig machen.</small>
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
            onClick={() => onDelete(false)}
          >
            Nur auf diesem Gerät löschen
          </button>
          <button
            className="danger-button"
            disabled={busy}
            onClick={() => onDelete(true)}
          >
            Seite und Serverkopien löschen
          </button>
        </div>
      </details>
      {error && <p className="inline-error">{error}</p>}
    </Modal>
  );
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const steps = [
    [
      "Zum Home-Bildschirm",
      "Öffne Inkloop in Safari. Tippe auf Teilen, dann auf «Zum Home-Bildschirm». Öffne Inkloop danach über das neue Symbol. Nach dem ersten vollständigen Laden funktioniert das Lernheft auch offline.",
    ],
    [
      "Chat daneben öffnen",
      "Nutze den iPad-Fenstermodus oder Split View für Inkloop und deinen Chat. Aufgaben kopierst du ins Lernheft oder lässt sie dir von ChatGPT schicken. Mit «Abgeben» bereitest du Bild und Anweisung vor.",
    ],
    [
      "Feedback im Lernbereich",
      "Mit dem ChatGPT-Plugin erscheinen Abschrift und Feedback automatisch im Lernbereich. Ohne Plugin oder mit Claude kopierst du die Antwort aus dem Chat und übernimmst sie mit «KI-Antwort übernehmen».",
    ],
  ];
  return (
    <Modal title="Installation und Hilfe" onClose={onClose}>
      {steps.map(([title, text], i) => (
        <div className="help-section" key={title}>
          <span className="step-number">{i + 1}</span>
          <div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        </div>
      ))}
      <div className="info-note">
        <CircleCheck size={20} />
        <span>
          Inkloop ruft keine kostenpflichtige KI-API auf. Die normalen
          Nachrichten- und Upload-Limits deines Abos gelten weiterhin. Du
          startest jeden Auftrag selbst in deinem Original-Chat.
        </span>
      </div>
      <details className="help-detail">
        <summary>Was bedeutet das Schriftprofil?</summary>
        <p>
          Deine vier beschrifteten Proben werden auf Wunsch unter dem
          Antwortbild ergänzt. Die KI kann sie zum Vergleichen nutzen. Das ist
          kein Modelltraining, keine Garantie für perfekte Erkennung und kann
          die Bildgrösse erhöhen.
        </p>
      </details>
      <details className="help-detail">
        <summary>Formeln, Tabellen und Mindmaps</summary>
        <p>
          Das Originalbild bewahrt alle Positionen und Verbindungen. Die
          Anweisung fordert die KI auf, Formeln, Tabellen und Beziehungen zu
          erhalten und Unklarheiten zu markieren. Prüfe besonders Vorzeichen,
          Zahlen und Soll/Haben-Spalten.
        </p>
      </details>
      <details className="help-detail">
        <summary>Schreiben, Radieren und Blättern</summary>
        <p>
          Pencil, ein Finger oder die Maus schreiben. Mit zwei Fingern scrollst
          du, ein waagrechter Wisch mit zwei Fingern blättert zur nächsten
          Seite. Der Radierer entfernt, was er berührt. Inkloop speichert,
          sobald du kurz absetzt. Sichere deine Lernhefte regelmässig als
          JSON-Datei.
        </p>
      </details>
    </Modal>
  );
}
