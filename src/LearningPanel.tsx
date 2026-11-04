import {
  ArrowDownToLine,
  Copy,
  FileText,
  Link2,
  MessageSquareText,
  PenLine,
  Plus,
  ScanText,
} from "lucide-react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import {
  MAX_TEXT_LENGTH,
  type AppData,
  type Page,
  type Submission,
} from "./model";
import { RichText } from "./ui";

export type PanelTab = "task" | "text" | "feedback";
const TABS: PanelTab[] = ["task", "text", "feedback"];
const LABELS: Record<PanelTab, string> = {
  task: "Aufgabe",
  text: "Abschrift",
  feedback: "Feedback",
};

const time = (t: number) =>
  new Date(t).toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });

export function LearningPanel({
  panelRef,
  data,
  page,
  submission,
  tab,
  open,
  inert,
  busy,
  chatLinked,
  connected,
  onTab,
  onEditTask,
  onImport,
  onCopy,
  onEditSubmission,
  onSolveNext,
  onSelectSubmission,
  onHandoff,
  onProvider,
  onLinkChat,
}: {
  panelRef: RefObject<HTMLElement | null>;
  data: AppData;
  page: Page;
  submission?: Submission;
  tab: PanelTab;
  open: boolean;
  inert: boolean;
  busy: boolean;
  chatLinked: boolean;
  /** ChatGPT selected and the plugin bridge answers. */
  connected: boolean;
  onTab: (tab: PanelTab) => void;
  onEditTask: () => void;
  onImport: () => void;
  onCopy: (text: string) => void;
  onEditSubmission: (patch: Partial<Submission>) => void;
  onSolveNext: (task: string) => void;
  onSelectSubmission: (id: string) => void;
  onHandoff: (submission: Submission) => void;
  onProvider: (provider: AppData["settings"]["provider"]) => void;
  onLinkChat: () => void;
}) {
  const filled: Record<PanelTab, boolean> = {
    task: !!page.task,
    text: !!submission?.transcription,
    feedback: !!submission?.feedback,
  };
  const keys = (e: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = TABS.indexOf(tab);
    const next =
      TABS[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? 2
            : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3
      ];
    onTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  const empty = (
    Icon: typeof FileText,
    title: string,
    hint: string,
    action?: { label: string; run: () => void },
  ) => (
    <div className="panel-empty">
      <Icon size={26} strokeWidth={1.5} aria-hidden="true" />
      <p>{title}</p>
      <small>{hint}</small>
      {action && (
        <button className="secondary" onClick={action.run}>
          {action.label === "Aufgabe einfügen" ? (
            <Plus size={16} />
          ) : (
            <ArrowDownToLine size={16} />
          )}{" "}
          {action.label}
        </button>
      )}
    </div>
  );
  const plugin = data.settings.provider === "chatgpt";
  return (
    <aside
      id="learning-panel"
      ref={panelRef}
      className="learning-panel"
      aria-label="Lernbereich"
      aria-hidden={!open}
      inert={inert}
    >
      <div
        className="panel-tabs segmented"
        role="tablist"
        aria-label="Lernansicht"
        onKeyDown={keys}
        style={{ "--tab": TABS.indexOf(tab) } as CSSProperties}
      >
        <span className="segmented-thumb" aria-hidden="true" />
        {TABS.map((t) => (
          <button
            key={t}
            id={`tab-${t}`}
            role="tab"
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            aria-controls="learning-content"
            className={tab === t ? "selected" : ""}
            onClick={() => onTab(t)}
          >
            {LABELS[t]}
            {filled[t] && <span className="tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div
        className="panel-content"
        id="learning-content"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        key={tab}
      >
        {tab === "task" &&
          (page.task ? (
            <div className="task-content">
              <RichText text={page.task} />
              <button className="text-button small" onClick={onEditTask}>
                <PenLine size={14} /> Bearbeiten
              </button>
            </div>
          ) : (
            empty(
              FileText,
              "Keine Aufgabe",
              connected
                ? "Füge eine Aufgabe ein oder lass sie dir von ChatGPT schicken."
                : "Füge die Aufgabe aus deinem Chat ein.",
              { label: "Aufgabe einfügen", run: onEditTask },
            )
          ))}
        {tab === "text" &&
          (submission?.transcription ? (
            <div className="answer-card">
              <div className="section-label">
                Abschrift
                <button
                  className="icon-button"
                  aria-label="Abschrift kopieren"
                  onClick={() => onCopy(submission.transcription)}
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
                    onEditSubmission({
                      transcription: e.target.value.slice(0, MAX_TEXT_LENGTH),
                    })
                  }
                />
                <small>Deine Korrektur wird lokal gespeichert.</small>
              </details>
            </div>
          ) : (
            empty(
              ScanText,
              "Keine Abschrift",
              submission
                ? "Sobald dein Chat die Abgabe gelesen hat, erscheint hier, was er erkannt hat."
                : "Gib deine Lösung ab. Dein Chat schreibt ab, was er lesen konnte.",
              submission
                ? { label: "KI-Antwort übernehmen", run: onImport }
                : undefined,
            )
          ))}
        {tab === "feedback" &&
          (submission?.feedback ? (
            <>
              <div className="answer-card">
                <div className="section-label">
                  Feedback
                  <button
                    className="icon-button"
                    aria-label="Feedback kopieren"
                    onClick={() => onCopy(submission.feedback)}
                  >
                    <Copy size={14} />
                  </button>
                </div>
                <RichText text={submission.feedback} />
              </div>
              {submission.nextTask && (
                <div className="next-task">
                  <span className="eyebrow">Nächste Aufgabe</span>
                  <RichText text={submission.nextTask} />
                  <button
                    className="secondary"
                    onClick={() => onSolveNext(submission.nextTask)}
                  >
                    <Plus size={16} /> Auf neuer Seite lösen
                  </button>
                </div>
              )}
            </>
          ) : (
            empty(
              MessageSquareText,
              "Noch kein Feedback",
              submission
                ? connected
                  ? "Die Antwort erscheint hier automatisch, sobald ChatGPT sie gespeichert hat."
                  : "Kopiere die Antwort aus deinem Chat und übernimm sie hier."
                : "Gib zuerst eine Lösung ab.",
              submission
                ? { label: "KI-Antwort übernehmen", run: onImport }
                : undefined,
            )
          ))}
        {page.submissions.length > 0 && (
          <div className="submission-history">
            <label htmlFor="submission-select">Abgaben auf dieser Seite</label>
            <select
              id="submission-select"
              value={submission?.id || ""}
              onChange={(e) => onSelectSubmission(e.target.value)}
            >
              {[...page.submissions].reverse().map((s, i) => (
                <option value={s.id} key={s.id}>
                  Abgabe {page.submissions.length - i} · {time(s.createdAt)}
                  {s.feedback ? " · mit Feedback" : ""}
                </option>
              ))}
            </select>
            {submission && plugin && (
              <div className="submission-status">
                <small>
                  {submission.handoff?.sent
                    ? "Für ChatGPT bereitgestellt"
                    : submission.handoff
                      ? "Nur auf diesem Gerät"
                      : "Sendestatus unbekannt"}
                </small>
                <button
                  className="text-button small"
                  disabled={busy}
                  onClick={() => onHandoff(submission)}
                >
                  {submission.handoff?.sent
                    ? "Übergabe öffnen"
                    : "Erneut an ChatGPT senden"}
                </button>
              </div>
            )}
            {submission &&
              (submission.transcription || submission.feedback) && (
                <button className="text-button small" onClick={onImport}>
                  <ArrowDownToLine size={14} /> Andere Antwort übernehmen
                </button>
              )}
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
              onProvider(e.target.value as AppData["settings"]["provider"])
            }
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude (manuell)</option>
          </select>
        </div>
        <button className="chat-link text-button small" onClick={onLinkChat}>
          <Link2 size={13} />
          {chatLinked ? "Chat ändern" : "Chat verknüpfen"}
        </button>
      </div>
    </aside>
  );
}
