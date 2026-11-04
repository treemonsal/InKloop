import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Check, CircleAlert, Info, X } from "lucide-react";
import type { Stroke } from "./model";
import { thumbnail } from "./ink";

const MarkdownText = lazy(() => import("./RichText"));

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active = false,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      className={`icon-button ${active ? "active" : ""} ${className}`}
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

export function Logo() {
  return <img src="./icon.svg" alt="" width={32} height={32} />;
}

const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the exit of the open sheet along the same path it entered, then runs
 * `done`. Falls back to an immediate close without animation support.
 */
export function dismissModal(done: () => void) {
  const dialog = document.querySelector<HTMLDialogElement>(
    "dialog.modal[open]:not(.leaving)",
  );
  if (!dialog || typeof dialog.animate !== "function" || reducedMotion()) {
    done();
    return;
  }
  dialog.classList.add("leaving");
  const exit = dialog.animate(
    [
      { opacity: 1, transform: "none", filter: "blur(0)" },
      {
        opacity: 0,
        transform: "translateY(10px) scale(0.965)",
        filter: "blur(6px)",
      },
    ],
    { duration: 170, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done();
  };
  exit.finished.then(finish, finish);
  setTimeout(finish, 260);
}

export function Modal({
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
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
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
        <IconButton label="Schliessen" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}

export function Miniature({
  strokes,
  light,
  live = true,
}: {
  strokes: Stroke[];
  light: boolean;
  /** While false the last drawing stays, so hidden thumbnails cost nothing. */
  live?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (live && ref.current) thumbnail(ref.current, strokes, light);
  }, [strokes, light, live]);
  return <canvas ref={ref} aria-hidden="true" />;
}

export function RichText({ text }: { text: string }) {
  return (
    <Suspense fallback={<div className="rich-text">{text}</div>}>
      <MarkdownText text={text} />
    </Suspense>
  );
}

export type ToastMessage = {
  id: number;
  message: string;
  kind: "success" | "info" | "error";
  action?: { label: string; run: () => void };
};

/** Bottom notice that rises in and sinks out along the same path. */
export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (toast) {
      setShown(toast);
      setLeaving(false);
      return;
    }
    if (!shown) return;
    if (reducedMotion()) {
      setShown(null);
      return;
    }
    setLeaving(true);
    const t = setTimeout(() => {
      setShown(null);
      setLeaving(false);
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);
  if (!shown) return null;
  const Icon =
    shown.kind === "error" ? CircleAlert : shown.kind === "info" ? Info : Check;
  return (
    <div
      key={shown.id}
      className={`toast toast-${shown.kind} ${leaving ? "leaving" : ""}`}
      role={shown.kind === "error" ? "alert" : "status"}
    >
      <Icon size={17} aria-hidden="true" />
      <span>{shown.message}</span>
      {shown.action && (
        <button
          className="toast-action"
          onClick={() => {
            shown.action?.run();
            onDismiss();
          }}
        >
          {shown.action.label}
        </button>
      )}
    </div>
  );
}
