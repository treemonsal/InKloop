import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Info,
  MessageSquareText,
  X,
} from "lucide-react";
import type { Stroke, SubmissionState } from "./model";
import { thumbnail } from "./ink";

const MarkdownText = lazy(() => import("./RichText"));

export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
  active,
  className = "",
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Only toggles pass this; plain actions stay plain buttons. */
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

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="./icon.svg" alt="" width={size} height={size} />;
}

export const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays the exit of the open sheet along the path it entered, then runs
 * `done`. Without animation support or with reduced motion it closes at once.
 */
export function dismissModal(done: () => void) {
  const dialog = document.querySelector<HTMLDialogElement>(
    "dialog.modal[open]:not(.leaving)",
  );
  if (!dialog || typeof dialog.animate !== "function" || reducedMotion()) {
    done();
    return;
  }
  // Leave the top layer at once: the page under the fading sheet takes taps
  // again immediately instead of losing them to the backdrop.
  dialog.close();
  dialog.show();
  dialog.classList.add("leaving");
  const exit = dialog.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: "translateY(8px) scale(0.98)" },
    ],
    { duration: 180, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" },
  );
  let finished = false;
  const finish = () => {
    if (finished || !dialog.classList.contains("leaving")) return;
    finished = true;
    done();
  };
  exit.finished.then(finish, () => {});
  setTimeout(finish, 260);
}

/**
 * A sheet tapped open again while it is still leaving comes back from where it
 * is, instead of staying invisible and swallowing taps.
 */
export function reviveModal() {
  for (const dialog of document.querySelectorAll<HTMLDialogElement>(
    "dialog.modal.leaving",
  )) {
    dialog.classList.remove("leaving");
    dialog.getAnimations?.().forEach((a) => a.cancel());
    dialog.close();
    dialog.showModal();
  }
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
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
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose();
      }}
    >
      <header className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Schliessen" onClick={onClose} className="round">
          <X />
        </IconButton>
      </header>
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

export const STATE_LABEL: Record<SubmissionState, string> = {
  local: "Lokal gespeichert",
  sent: "Abgegeben",
  failed: "Übertragung fehlgeschlagen",
  answered: "Feedback erhalten",
};
const STATE_ICON = {
  local: CircleDashed,
  sent: CircleCheck,
  failed: CircleAlert,
  answered: MessageSquareText,
};
/** The single visual vocabulary for a submission's state. */
export function StateLabel({ state }: { state: SubmissionState }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={`state state-${state}`}>
      <Icon aria-hidden="true" />
      {STATE_LABEL[state]}
    </span>
  );
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

// Distance a release at `velocity` px/s would still travel (scroll-like decay).
const project = (velocity: number, rate = 0.99) =>
  ((velocity / 1000) * rate) / (1 - rate);
const rubberband = (overshoot: number, size: number, c = 0.55) =>
  (overshoot * size * c) / (size + c * Math.abs(overshoot));

/**
 * Lets an open drawer follow the finger horizontally and decides on release
 * from where the gesture is heading. Vertical scrolling stays native.
 */
export function useDrawerDrag(
  ref: RefObject<HTMLElement | null>,
  side: "left" | "right",
  enabled: boolean,
  onClose: () => void,
) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const closing = side === "left" ? -1 : 1;
    let drag: {
      id: number;
      x: number;
      y: number;
      width: number;
      active: boolean;
      samples: { x: number; t: number }[];
    } | null = null;
    let swallowClick = false;
    const reset = () => {
      el.classList.remove("dragging");
      el.style.transform = "";
    };
    const down = (e: PointerEvent) => {
      if (e.button > 0 || drag) return;
      drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        width: el.offsetWidth || 1,
        active: false,
        samples: [{ x: e.clientX, t: e.timeStamp }],
      };
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          drag = null; // a scroll, not a dismiss
          return;
        }
        if (Math.abs(dx) < 10) return;
        drag.active = true;
        drag.x = e.clientX; // hysteresis: track from here, no jump
        el.classList.add("dragging");
        el.setPointerCapture?.(e.pointerId);
      }
      const travel = (e.clientX - drag.x) * closing;
      const offset = travel >= 0 ? travel : -rubberband(-travel, drag.width);
      el.style.transform = `translateX(${offset * closing}px)`;
      drag.samples.push({ x: e.clientX, t: e.timeStamp });
      if (drag.samples.length > 5) drag.samples.shift();
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const done = drag;
      drag = null;
      if (!done.active) return;
      swallowClick = true;
      setTimeout(() => (swallowClick = false), 0);
      const first = done.samples[0],
        last = done.samples.at(-1)!;
      const velocity =
        ((last.x - first.x) / Math.max(1, last.t - first.t)) * 1000 * closing;
      const travel = (e.clientX - done.x) * closing;
      reset();
      if (e.type === "pointerup" && travel + project(velocity) > done.width / 2)
        close.current();
    };
    const click = (e: MouseEvent) => {
      if (!swallowClick) return;
      e.stopPropagation();
      e.preventDefault();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      reset();
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    };
  }, [ref, side, enabled]);
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
    }, 200);
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
      <Icon aria-hidden="true" />
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
