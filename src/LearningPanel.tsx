import {
  ArrowDownToLine,
  Copy,
  ExternalLink,
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
  submissionState,
  type AppData,
  type Page,
  type Submission,
} from "./model";
import { RichText, StateLabel } from "./ui";

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
  chatUrl,
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
  /** The saved link, if any. It never implies a live connection. */
  chatUrl: string;
  /** ChatGPT selected and the plugin bridge answers right now. */
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
  const chatgpt = data.settings.provider === "chatgpt";
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
    action?: { label: string; icon: typeof Plus; run: () => void },
  ) => (
    <div className="empty">
      <Icon strokeWidth={1.5} aria-hidden="true" />
      <p>{title}</p>
      {action && (
        <button className="secondary" onClick={action.run}>
          <action.icon /> {action.label}
        </button>
      )}
    </div>
  );
  const importAction = {
    label: "KI-Antwort übernehmen",
    icon: ArrowDownToLine,
    run: onImport,
  };
  const state = submission && submissionState(submission);
  const sendLabel =
    state === "failed"
      ? "Erneut senden"
      : state === "sent" || state === "answered"
        ? "Übergabe öffnen"
        : "An ChatGPT senden";
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
        className="segmented"
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
            {t === "feedback" && submission?.feedback && (
              <span className="tab-dot" aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      <div className="panel-scroll">
        <div
          className="panel-content"
          id="learning-content"
          role="tabpanel"
          aria-labelledby={`tab-${tab}`}
          key={tab}
        >
          {tab === "task" &&
            (page.task ? (
              <section className="reading">
                <RichText text={page.task} />
                <div className="reading-actions">
                  <button className="text-button" onClick={onEditTask}>
                    <PenLine /> Bearbeiten
                  </button>
                </div>
              </section>
            ) : (
              empty(FileText, "Keine Aufgabe", {
                label: "Aufgabe einfügen",
                icon: Plus,
                run: onEditTask,
              })
            ))}
          {tab === "text" &&
            (submission?.transcription ? (
              <section className="reading">
                <RichText text={submission.transcription} />

                <div className="reading-actions">
                  <button
                    className="text-button"
                    aria-label="Abschrift kopieren"
                    onClick={() => onCopy(submission.transcription)}
                  >
                    <Copy /> Kopieren
                  </button>
                  <details className="edit-details">
                    <summary>
                      <PenLine /> Korrigieren
                    </summary>
                    <textarea
                      aria-label="Abschrift korrigieren"
                      maxLength={MAX_TEXT_LENGTH}
                      value={submission.transcription}
                      onChange={(e) =>
                        onEditSubmission({
                          transcription: e.target.value.slice(
                            0,
                            MAX_TEXT_LENGTH,
                          ),
                        })
                      }
                    />
                  </details>
                </div>
              </section>
            ) : (
              empty(
                ScanText,
                submission ? "Noch keine Abschrift" : "Noch nichts abgegeben",
                submission ? importAction : undefined,
              )
            ))}
          {tab === "feedback" &&
            (submission?.feedback ? (
              <>
                <section className="reading">
                  <RichText text={submission.feedback} />
                  <div className="reading-actions">
                    <button
                      className="text-button"
                      aria-label="Feedback kopieren"
                      onClick={() => onCopy(submission.feedback)}
                    >
                      <Copy /> Kopieren
                    </button>
                  </div>
                </section>
                {submission.nextTask && (
                  <section className="next-task">
                    <h3>Nächste Aufgabe</h3>
                    <RichText text={submission.nextTask} />
                    <button
                      className="secondary"
                      onClick={() => onSolveNext(submission.nextTask)}
                    >
                      <Plus /> Auf neuer Seite lösen
                    </button>
                  </section>
                )}
              </>
            ) : (
              empty(
                MessageSquareText,
                submission ? "Noch kein Feedback" : "Noch nichts abgegeben",
                submission ? importAction : undefined,
              )
            ))}
        </div>
        {page.submissions.length > 0 && (
          <section className="submissions" aria-label="Abgaben">
            <h3>Abgaben</h3>
            <ul>
              {[...page.submissions].reverse().map((s, i) => (
                <li key={s.id}>
                  <button
                    className={`submission ${s.id === submission?.id ? "selected" : ""}`}
                    aria-current={s.id === submission?.id ? "true" : undefined}
                    onClick={() => onSelectSubmission(s.id)}
                  >
                    <span className="submission-name">
                      Abgabe {page.submissions.length - i}
                      <small>{time(s.createdAt)}</small>
                    </span>
                    <StateLabel state={submissionState(s)} />
                  </button>
                </li>
              ))}
            </ul>
            {submission && (
              <div className="submission-actions">
                {chatgpt && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => onHandoff(submission)}
                  >
                    {sendLabel}
                  </button>
                )}
                {(submission.transcription || submission.feedback) && (
                  <button className="text-button" onClick={onImport}>
                    <ArrowDownToLine /> Andere Antwort übernehmen
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </div>
      <footer className="panel-footer">
        <label className="chat-provider">
          <span>Chat</span>
          <select
            aria-label="KI-Anbieter"
            value={data.settings.provider}
            onChange={(e) =>
              onProvider(e.target.value as AppData["settings"]["provider"])
            }
          >
            <option value="chatgpt">ChatGPT</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <p className="connection">
          <span
            className={`dot ${chatgpt && connected ? "on" : ""}`}
            aria-hidden="true"
          />
          {chatgpt
            ? connected
              ? "Plugin verbunden"
              : "Plugin nicht erreichbar"
            : "Manuelle Übergabe"}
        </p>
        <div className="chat-link">
          {chatUrl && (
            <a href={chatUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Chat öffnen
            </a>
          )}
          <button className="text-button" onClick={onLinkChat}>
            <Link2 /> {chatUrl ? "Link ändern" : "Chat-Link hinzufügen"}
          </button>
        </div>
      </footer>
    </aside>
  );
}
