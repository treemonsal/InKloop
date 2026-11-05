import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  HardDrive,
  HelpCircle,
  LogOut,
  Minus,
  Plus,
  Trash2,
  Undo2,
  Upload,
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
export const INK_NAMES = ["Weiss", "Grau", "Blau"];
const SAMPLE_LABELS = [
  "a g q y z · b d p · m n u · I l 1",
  "0 O · 1 7 · 2 Z · 5 S · 8 B · 6 9",
  "x² + 3x = 12 · ½ · −4,75 · CHF 1’250.00",
  "Soll / Haben · Aufwand / Ertrag · The quick brown fox.",
];

/** A grouped list, the one container for settings-like content. */
function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="group">
      {title && <h3>{title}</h3>}
      <div className="group-rows">{children}</div>
    </section>
  );
}
function Row({ label, children }: { label: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      {children}
    </div>
  );
}

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
    <Modal title="Deine Handschrift" onClose={onClose} wide>
      <div className="profile-progress" aria-label={`Probe ${step + 1} von 4`}>
        {SAMPLE_LABELS.map((_, i) => (
          <span key={i} className={i <= step ? "done" : ""} />
        ))}
      </div>
      <p className="sample-target">{SAMPLE_LABELS[step]}</p>
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
      <div className="sheet-actions">
        <IconButton
          label="Probe rückgängig"
          disabled={!undo}
          onClick={() => {
            if (undo) setInk(undo);
            setUndo(null);
          }}
        >
          <Undo2 />
        </IconButton>
        <button
          className="text-button"
          disabled={!ink.length}
          onClick={() => {
            setUndo(ink);
            setInk([]);
          }}
        >
          <Eraser /> Neu schreiben
        </button>
        <button
          className="primary push"
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
          {last ? <Check /> : <ArrowRight />}
        </button>
      </div>
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
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onCreate(name.trim());
        }}
      >
        <input
          autoFocus
          aria-label="Name oder Fach"
          className="field"
          maxLength={150}
          placeholder="Fach, z. B. Französisch"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="primary block" disabled={!name.trim()} type="submit">
          Erstellen
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
      <p className="sheet-text">
        «{notebook.name}» mit {notebook.pages.length}{" "}
        {notebook.pages.length === 1 ? "Seite" : "Seiten"} wird auf diesem Gerät
        gelöscht. Abgaben auf dem Server bleiben bestehen.
      </p>
      <div className="sheet-actions">
        <button className="secondary push" autoFocus onClick={onClose}>
          Abbrechen
        </button>
        <button className="danger" disabled={locked} onClick={onDelete}>
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
        className="field large"
        aria-label="Aufgabe"
        placeholder="Aufgabe einfügen"
        value={draft}
        maxLength={MAX_TEXT_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button className="primary block" onClick={() => onSave(draft.trim())}>
        Aufgabe speichern
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
      <p className="sheet-text muted">
        {submission
          ? `Für Abgabe von ${new Date(submission.createdAt).toLocaleTimeString(
              "de-CH",
              { hour: "2-digit", minute: "2-digit" },
            )}. `
          : ""}
        Den JSON-Block oder Text aus dem Chat einfügen.
      </p>
      <textarea
        autoFocus
        className="field large"
        aria-label="KI-Antwort"
        placeholder={'{"transcription": "…", "feedback": "…"}'}
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
        className="primary block"
        disabled={!draft.trim()}
        onClick={() => {
          try {
            onApply(parseResponse(draft));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <ArrowDownToLine /> Im Lernheft speichern
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
  /** The upload was attempted and failed. */
  failed: boolean;
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
  notify: (message: string, kind?: "success" | "info" | "error") => void;
  copyText: (text: string) => Promise<boolean>;
}) {
  const [copied, setCopied] = useState<"none" | "done" | "manual">("none");
  const pluginPrompt = `Lies meine Inkloop-Abgabe ${prepared.submission.id} mit dem Inkloop-Plugin. Transkribiere die Handschrift originalgetreu, gib anschliessend Lernfeedback und speichere beides mit inkloop_write_response zurück. Nutze den Kontext unseres Chats.`;
  const copyImage = async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
        throw new Error();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": prepared.blob }),
      ]);
      notify("Bild kopiert.");
    } catch {
      notify("Bild kopieren geht hier nicht. Nutze Teilen.", "error");
    }
  };
  const share = () => {
    const file = new File([prepared.blob], fileName, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      navigator
        .share({ files: [file], title: "Inkloop – Meine Lösung" })
        .catch((e) => {
          if (e.name !== "AbortError")
            notify("Teilen fehlgeschlagen. Speichere das Bild.", "error");
        });
    } else {
      download(prepared.blob, fileName);
      notify("Bild wird gespeichert.");
    }
  };
  const manual = (
    <div className="handoff">
      <a href={prepared.url} download={fileName} className="handoff-preview">
        <img src={prepared.url} alt="Deine Antwort als Bild" />
      </a>
      <div className="handoff-actions">
        <button className="secondary" onClick={() => void copyImage()}>
          <Copy /> Bild kopieren
        </button>
        <button className="secondary" onClick={share}>
          <Upload /> Teilen
        </button>
        <button
          className="secondary wide"
          onClick={() => void copyText(prepared.prompt)}
        >
          <Copy /> Anweisung kopieren
        </button>
        {!prepared.shared && (
          <a
            className="primary wide"
            href={chatLink(chatUrl, provider)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Chat öffnen <ExternalLink />
          </a>
        )}
      </div>
    </div>
  );
  return (
    <Modal
      title={prepared.shared ? "Abgegeben" : "Lokal gespeichert"}
      onClose={onClose}
      wide
    >
      {prepared.failed && (
        <p className="notice notice-error" role="alert">
          <CircleAlert /> Übertragung fehlgeschlagen. Die Abgabe ist lokal
          gespeichert. Im Lernbereich kannst du sie erneut senden.
        </p>
      )}
      {!prepared.shared && (
        <p className="sheet-text muted">
          Bild und Anweisung in deinen Chat geben.
        </p>
      )}
      {prepared.shared ? (
        <>
          <ol className="steps">
            <li className={copied === "none" ? "current" : "done"}>
              <span className="step-mark">
                {copied === "none" ? "1" : <Check />}
              </span>
              <span className="step-body">
                Auftrag kopieren
                <button
                  className={copied === "none" ? "primary" : "secondary"}
                  onClick={async () =>
                    setCopied(
                      (await copyText(pluginPrompt)) ? "done" : "manual",
                    )
                  }
                >
                  <Copy /> {copied === "none" ? "Kopieren" : "Erneut kopieren"}
                </button>
              </span>
            </li>
            <li className={copied === "none" ? "" : "current"}>
              <span className="step-mark">2</span>
              <span className="step-body">
                Im Chat einfügen und senden
                <a
                  className={copied === "none" ? "secondary" : "primary"}
                  href={chatLink(notebook?.chatUrl ?? "", "chatgpt")}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ChatGPT öffnen <ExternalLink />
                </a>
              </span>
            </li>
          </ol>
          {copied === "manual" && (
            <textarea
              className="field large"
              aria-label="Auftrag für ChatGPT"
              value={pluginPrompt}
              readOnly
            />
          )}
          <p className="sheet-text muted">
            Das Feedback erscheint danach im Lernbereich.
          </p>
          <details className="disclosure">
            <summary>Manuell übergeben</summary>
            {manual}
          </details>
        </>
      ) : (
        manual
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
      className="inline-form"
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
                "Der Link passt nicht zum gewählten Chat. Den Chat wählst du im Lernbereich.",
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
        className="field"
        aria-label="Link zum bestehenden Chat"
        value={value}
        maxLength={2000}
        inputMode="url"
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          provider === "chatgpt"
            ? "https://chatgpt.com/c/…"
            : "https://claude.ai/chat/…"
        }
      />
      <button
        className="secondary"
        type="submit"
        disabled={value.trim() === initial}
      >
        Sichern
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
  notify: (message: string, kind?: "success" | "info" | "error") => void;
}) {
  if (restoring)
    return (
      <Modal title="Sicherung laden?" onClose={onClose}>
        <p className="sheet-text">
          Ersetzt alle Lernhefte und Schriftproben auf diesem Gerät.
        </p>
        <div className="sheet-actions stacked">
          <button className="secondary block" onClick={onBackup}>
            <Download /> Aktuellen Stand zuerst sichern
          </button>
          <button className="danger block" onClick={onConfirmRestore}>
            Durch Sicherung ersetzen
          </button>
        </div>
      </Modal>
    );
  const chatgpt = data.settings.provider === "chatgpt";
  return (
    <Modal title="Einstellungen" onClose={onClose}>
      <Group>
        <Row label="Darstellung">
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
        </Row>
        <Row
          label={
            <>
              Schriftprofil mitsenden
              <small>
                {data.samples.length
                  ? `${data.samples.length} Proben`
                  : "Noch keine Proben"}
              </small>
            </>
          }
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="Schriftprofil mitsenden"
            checked={data.settings.includeProfile}
            onChange={(e) => onSettings({ includeProfile: e.target.checked })}
          />
        </Row>
      </Group>
      {notebook && (
        <Group title={`Chat-Link für ${notebook.name}`}>
          <div className="row row-form">
            <ChatForm
              key={data.settings.provider}
              initial={chatUrl}
              provider={data.settings.provider}
              onSave={onSaveChat}
            />
          </div>
        </Group>
      )}
      <Group title="ChatGPT-Plugin">
        <Row label="Status">
          <span className="connection">
            <span
              className={`dot ${chatgpt && bridgeReady ? "on" : ""}`}
              aria-hidden="true"
            />
            {!chatgpt
              ? "Claude gewählt"
              : bridgeReady
                ? "Verbunden"
                : "Nicht erreichbar"}
          </span>
        </Row>
      </Group>
      <Group title="Daten auf diesem Gerät">
        <button className="row row-button" onClick={onBackup}>
          <Download /> Sicherung herunterladen
        </button>
        <button className="row row-button" onClick={onPickRestore}>
          <Upload /> Sicherung laden
        </button>
        <button
          className="row row-button"
          onClick={async () => {
            try {
              const granted = await navigator.storage?.persist?.();
              notify(
                granted
                  ? "Speicher ist dauerhaft."
                  : "Safari verwaltet den Speicher. Sichere regelmässig.",
                granted ? "success" : "info",
              );
            } catch {
              notify("Sichere regelmässig.", "info");
            }
          }}
        >
          <HardDrive /> Speicher dauerhaft machen
        </button>
      </Group>
      <Group>
        <button className="row row-button" onClick={onHelp}>
          <HelpCircle /> Hilfe
        </button>
        {hosted && (
          <a
            className="row row-button"
            href="/signout-with-chatgpt?return_to=%2F"
            target="_top"
          >
            <LogOut /> Abmelden
          </a>
        )}
      </Group>
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
  const [confirm, setConfirm] = useState(false);
  // Anything that may have reached the server offers to remove it there too.
  const shared = page.submissions.some(
    (s) => s.handoff?.sent || s.handoff?.failed,
  );
  return (
    <Modal title="Seite" onClose={onClose}>
      <input
        className="field page-title"
        value={page.title}
        maxLength={150}
        aria-label="Seitentitel"
        onChange={(e) => onPatch({ title: e.target.value })}
      />
      <Group>
        <Row label="Papier">
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
        </Row>
        <Row label="Sprache">
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
        </Row>
        <Row label="Zoom">
          <span className="stepper" role="group" aria-label="Zoom">
            <IconButton
              label="Verkleinern"
              disabled={zoom <= 1}
              onClick={() => onZoom(Math.max(1, zoom - 0.25))}
            >
              <Minus />
            </IconButton>
            <output>{Math.round(zoom * 100)} %</output>
            <IconButton
              label="Vergrössern"
              disabled={zoom >= 2}
              onClick={() => onZoom(Math.min(2, zoom + 0.25))}
            >
              <Plus />
            </IconButton>
          </span>
        </Row>
      </Group>
      <Group>
        <button className="row row-button" onClick={onDuplicate}>
          <Copy /> Seite duplizieren
        </button>
        <button
          className="row row-button"
          disabled={!page.strokes.length || busy}
          onClick={onSaveImage}
        >
          <Download /> Als Bild speichern
        </button>
        <button
          className="row row-button"
          disabled={!page.strokes.length}
          onClick={onClear}
        >
          <Eraser /> Handschrift leeren
        </button>
      </Group>
      <Group>
        {!confirm ? (
          <button
            className="row row-button danger-text"
            onClick={() => setConfirm(true)}
          >
            <Trash2 /> Seite löschen
          </button>
        ) : (
          <div className="row row-confirm">
            {shared && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => onDelete(false)}
              >
                Nur hier löschen
              </button>
            )}
            <button
              className="danger"
              disabled={busy}
              onClick={() => onDelete(shared)}
            >
              {shared ? "Auch Serverkopien" : "Löschen"}
            </button>
          </div>
        )}
      </Group>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

export function HelpSheet({ onClose }: { onClose: () => void }) {
  const items: [string, string][] = [
    [
      "Installieren",
      "In Safari teilen, dann «Zum Home-Bildschirm». Danach immer über das Symbol öffnen.",
    ],
    [
      "Schreiben",
      "Pencil, Finger oder Maus schreiben. Zwei Finger scrollen, ein waagrechter Wisch mit zwei Fingern blättert.",
    ],
    [
      "Abgeben",
      "«Abgeben» erstellt ein Bild deiner Lösung. Mit dem ChatGPT-Plugin landet es direkt bei ChatGPT, sonst teilst du es selbst.",
    ],
    [
      "Feedback",
      "Mit Plugin erscheint es im Lernbereich. Sonst die Antwort aus dem Chat mit «KI-Antwort übernehmen» einfügen.",
    ],
    [
      "Sichern",
      "Lernhefte liegen nur auf diesem Gerät. Lade regelmässig eine Sicherung herunter.",
    ],
  ];
  return (
    <Modal title="Hilfe" onClose={onClose}>
      <dl className="help">
        {items.map(([term, text]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <p className="sheet-text muted">
        Inkloop ruft keine kostenpflichtige KI auf. Es gelten die Limits deines
        Chat-Abos.
      </p>
    </Modal>
  );
}
