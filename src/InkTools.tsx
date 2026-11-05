import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Eraser,
  Highlighter,
  Minus,
  PenLine,
  Redo2,
  Undo2,
} from "lucide-react";
import type { Tool } from "./Canvas";
import { displayInkColor } from "./ink";
import { INK_NAMES, INK_PALETTE } from "./Sheets";
import { IconButton } from "./ui";

const WIDTHS = [1.5, 2.5, 4];
const WIDTH_NAMES = ["Fein", "Mittel", "Breit"];
const TOOLS = [
  ["pen", "Stift", PenLine],
  ["marker", "Textmarker", Highlighter],
  ["eraser", "Radierer", Eraser],
  ["line", "Gerade Linie", Minus],
] as const;

/**
 * The writing tools as one capsule. Colour and width live in one popover so
 * the bar stays short enough for portrait.
 */
export function InkTools({
  tool,
  color,
  width,
  light,
  inert,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onWidth,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  color: string;
  width: number;
  light: boolean;
  inert: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (tool: Tool) => void;
  onColor: (color: string) => void;
  onWidth: (width: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (wrap.current?.contains(e.target as Node)) return;
      setOpen(false);
      // A tap on the sheet only dismisses; it must not leave a dot behind.
      if ((e.target as Element).closest?.(".paper-scroll")) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => {
    if (inert) setOpen(false);
  }, [inert]);
  const ink = displayInkColor(color, light);
  return (
    <div className="ink-tools" ref={wrap}>
      <div
        className="capsule"
        role="toolbar"
        aria-label="Schreibwerkzeuge"
        inert={inert}
      >
        {TOOLS.map(([t, label, Icon]) => (
          <IconButton
            key={t}
            label={label}
            active={tool === t}
            onClick={() => onTool(t)}
          >
            <Icon />
          </IconButton>
        ))}
        <span className="capsule-divider" aria-hidden="true" />
        <button
          className={`icon-button swatch-button ${open ? "active" : ""}`}
          aria-label={`Farbe und Strich: ${INK_NAMES[INK_PALETTE.indexOf(color)] ?? ""}, ${WIDTH_NAMES[WIDTHS.indexOf(width)] ?? ""}`}
          aria-expanded={open}
          aria-haspopup="true"
          onClick={() => setOpen(!open)}
        >
          <span
            className="swatch"
            style={
              {
                "--ink": ink,
                "--size": `${8 + width * 2}px`,
              } as CSSProperties
            }
          />
        </button>
        <span className="capsule-divider" aria-hidden="true" />
        <IconButton label="Rückgängig" disabled={!canUndo} onClick={onUndo}>
          <Undo2 />
        </IconButton>
        <IconButton label="Wiederholen" disabled={!canRedo} onClick={onRedo}>
          <Redo2 />
        </IconButton>
      </div>
      <div
        className={`popover ${open ? "open" : ""}`}
        role="group"
        aria-label="Farbe und Strich"
        inert={!open}
      >
        <div className="popover-row" role="radiogroup" aria-label="Farbe">
          {INK_PALETTE.map((c, i) => (
            <button
              key={c}
              role="radio"
              aria-checked={c === color}
              aria-label={`Farbe ${INK_NAMES[i]}`}
              className={`swatch-choice ${c === color ? "selected" : ""}`}
              style={{ "--ink": displayInkColor(c, light) } as CSSProperties}
              onClick={() => {
                onColor(c);
                if (tool === "eraser") onTool("pen");
              }}
            />
          ))}
        </div>
        <div className="popover-row" role="radiogroup" aria-label="Strich">
          {WIDTHS.map((w, i) => (
            <button
              key={w}
              role="radio"
              aria-checked={w === width}
              aria-label={`Strich ${WIDTH_NAMES[i]}`}
              className={`width-choice ${w === width ? "selected" : ""}`}
              onClick={() => onWidth(w)}
            >
              <span
                style={
                  {
                    "--ink": ink,
                    "--size": `${2 + w * 2.4}px`,
                  } as CSSProperties
                }
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
