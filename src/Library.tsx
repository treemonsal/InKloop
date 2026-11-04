import {
  ArrowRight,
  Fingerprint,
  MoreHorizontal,
  NotebookPen,
  PenLine,
  Plus,
  Settings2,
} from "lucide-react";
import type { CSSProperties } from "react";
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
  banner: React.ReactNode;
  locked: boolean;
  onOpen: (n: Notebook) => void;
  onCreate: () => void;
  onOptions: (n: Notebook) => void;
  onProfile: () => void;
  onSettings: () => void;
}) {
  const feedbackCount = (n: Notebook) =>
    n.pages.reduce(
      (sum, p) => sum + p.submissions.filter((s) => s.feedback).length,
      0,
    );
  return (
    <main className="library">
      <header className="library-top">
        <div className="library-brand">
          <Logo /> Inkloop
        </div>
        <div className="topbar-actions">
          <IconButton label="Deine Handschrift" onClick={onProfile}>
            <Fingerprint size={20} />
          </IconButton>
          <IconButton label="Einstellungen" onClick={onSettings}>
            <Settings2 size={20} />
          </IconButton>
        </div>
      </header>
      {banner}
      <div className="library-content">
        <div className="library-heading">
          <h1>Lernhefte</h1>
          <button className="primary" onClick={onCreate}>
            <Plus size={17} /> Neues Lernheft
          </button>
        </div>
        {notebook &&
          page &&
          (notebook.lastPageId || page.task || page.strokes.length > 0) && (
            <button
              className="resume-notebook"
              onClick={() => onOpen(notebook)}
            >
              <PenLine size={20} />
              <span>
                <strong>Weiterschreiben</strong>
                <small>
                  {notebook.name} / {page.title}
                </small>
              </span>
              <ArrowRight size={18} />
            </button>
          )}
        {!data.notebooks.length && (
          <div className="library-empty">
            <NotebookPen size={30} strokeWidth={1.5} />
            <p>Keine Lernhefte</p>
            <small>Lege für jedes Fach ein eigenes Heft an.</small>
          </div>
        )}
        <ul className="library-list" aria-label="Lernhefte">
          {data.notebooks.map((n, index) => {
            const preview =
              n.id === notebook?.id && page
                ? page
                : (n.pages.find((p) => p.id === n.lastPageId) ?? n.pages[0]);
            const answers = feedbackCount(n);
            const edited = lastEdited(n);
            return (
              <li
                key={n.id}
                style={
                  {
                    "--cover": n.color,
                    "--i": Math.min(index, 8),
                  } as CSSProperties
                }
              >
                <button
                  className="library-notebook"
                  aria-label={n.name}
                  onClick={() => onOpen(n)}
                >
                  <span className="notebook-cover" aria-hidden="true">
                    <span className={`cover-paper paper-${preview.paper}`}>
                      <Miniature strokes={preview.strokes} light={light} />
                    </span>
                  </span>
                  <span className="library-name">
                    <span>{n.name}</span>
                    <small>
                      {n.pages.length}{" "}
                      {n.pages.length === 1 ? "Seite" : "Seiten"}
                      {answers > 0 &&
                        ` · ${answers} ${answers === 1 ? "Feedback" : "Feedbacks"}`}
                      {edited && ` · ${edited}`}
                    </small>
                  </span>
                </button>
                <button
                  className="icon-button notebook-options"
                  aria-label={`Optionen für ${n.name}`}
                  title="Lernheft löschen"
                  disabled={locked}
                  onClick={() => onOptions(n)}
                >
                  <MoreHorizontal size={21} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
