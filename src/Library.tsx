import {
  ChevronRight,
  Fingerprint,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";
import type { AppData, Notebook, Page } from "./model";
import { IconButton, Logo, Miniature } from "./ui";
import { lastEdited } from "./updates";

export function Library({
  data,
  notebook,
  page,
  light,
  banner,
  locked,
  onOpen,
  onCreate,
  onOptions,
  onProfile,
  onSettings,
}: {
  data: AppData;
  notebook?: Notebook;
  page?: Page;
  light: boolean;
  banner: ReactNode;
  locked: boolean;
  onOpen: (n: Notebook) => void;
  onCreate: () => void;
  onOptions: (n: Notebook) => void;
  onProfile: () => void;
  onSettings: () => void;
}) {
  const answered = (n: Notebook) =>
    n.pages.reduce(
      (sum, p) =>
        sum + p.submissions.filter((s) => s.feedback || s.transcription).length,
      0,
    );
  const resume =
    notebook &&
    page &&
    (notebook.lastPageId || page.task || page.strokes.length > 0);
  return (
    <main className="library">
      <header className="library-bar">
        <span className="library-brand">
          <Logo /> Inkloop
        </span>
        <span className="bar-group">
          <IconButton label="Deine Handschrift" onClick={onProfile}>
            <Fingerprint />
          </IconButton>
          <IconButton label="Einstellungen" onClick={onSettings}>
            <Settings2 />
          </IconButton>
        </span>
      </header>
      {banner}
      <div className="library-content">
        <div className="library-heading">
          <h1>Lernhefte</h1>
          {data.notebooks.length > 0 && (
            <button className="secondary" onClick={onCreate}>
              <Plus /> Neues Lernheft
            </button>
          )}
        </div>
        {resume && (
          <button className="resume" onClick={() => onOpen(notebook)}>
            <span className="resume-sheet" aria-hidden="true">
              <Miniature strokes={page.strokes} light={light} />
            </span>
            <span className="resume-text">
              <strong>Weiterschreiben</strong>
              <small>
                {notebook.name}, {page.title}
              </small>
            </span>
            <ChevronRight className="resume-chevron" />
          </button>
        )}
        {!data.notebooks.length && (
          <div className="empty">
            <NotebookPen strokeWidth={1.5} />
            <p>Keine Lernhefte</p>
            <button className="primary" onClick={onCreate}>
              <Plus /> Lernheft erstellen
            </button>
          </div>
        )}
        <ul className="library-grid" aria-label="Lernhefte">
          {data.notebooks.map((n) => {
            const preview =
              n.id === notebook?.id && page
                ? page
                : (n.pages.find((p) => p.id === n.lastPageId) ?? n.pages[0]);
            const count = answered(n);
            return (
              <li key={n.id}>
                <button
                  className="notebook"
                  aria-label={n.name}
                  onClick={() => onOpen(n)}
                >
                  <span
                    className={`notebook-sheet paper-${preview.paper}`}
                    aria-hidden="true"
                  >
                    <Miniature strokes={preview.strokes} light={light} />
                    {count > 0 && (
                      <span className="notebook-badge">
                        {count} {count === 1 ? "Feedback" : "Feedbacks"}
                      </span>
                    )}
                  </span>
                  <span className="notebook-name">{n.name}</span>
                  <span className="notebook-meta">
                    <span>
                      {n.pages.length}{" "}
                      {n.pages.length === 1 ? "Seite" : "Seiten"}
                    </span>
                    <span>{lastEdited(n)}</span>
                  </span>
                </button>
                <IconButton
                  label={`Optionen für ${n.name}`}
                  className="notebook-options round"
                  disabled={locked}
                  onClick={() => onOptions(n)}
                >
                  <MoreHorizontal />
                </IconButton>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
