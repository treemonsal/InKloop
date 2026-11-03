import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import { eraseAlong, uid, type Point, type Stroke, type Paper } from "./model";
import { PAGE_H, PAGE_W, drawStroke, renderInk } from "./ink";
export type Tool = "pen" | "marker" | "eraser" | "line";
type Props = {
  strokes: Stroke[];
  onChange: (s: Stroke[]) => void;
  tool: Tool;
  color: string;
  width: number;
  touchWriting: boolean;
  paper: Paper;
  zoom?: number;
  label?: string;
  disabled?: boolean;
};
export default function InkCanvas({
  strokes,
  onChange,
  tool,
  color,
  width,
  touchWriting,
  paper,
  zoom = 1,
  label = "Schreibfläche",
  disabled = false,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    committedCanvas = useRef<HTMLCanvasElement>(null),
    painted = useRef<Stroke[] | null>(null),
    live = useRef<Stroke | null>(null),
    eraserPoint = useRef<Point | null>(null),
    base = useRef(strokes),
    pointer = useRef<number | null>(null),
    frame = useRef(0),
    working = useRef<Stroke[]>(strokes);
  const change = useRef(onChange);
  change.current = onChange;
  const paint = () => {
    if (committedCanvas.current && painted.current !== working.current) {
      renderInk(committedCanvas.current, working.current);
      painted.current = working.current;
    }
    if (canvas.current)
      renderInk(canvas.current, [], live.current || undefined);
  };
  useLayoutEffect(() => {
    base.current = strokes;
    working.current = strokes;
    paint();
  }, [strokes]);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (pointer.current !== null) {
        const result = live.current
          ? [...working.current, live.current]
          : working.current;
        if (live.current?.tool === "marker" && live.current.points.length < 2)
          return;
        if (result !== base.current) change.current(result);
      }
    },
    [],
  );
  const redraw = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  };
  const point = (
    e: { clientX: number; clientY: number; pressure: number },
    rect: DOMRect,
    fallbackPressure = 0.5,
  ): Point => {
    return {
      x: Math.max(
        0,
        Math.min(PAGE_W, ((e.clientX - rect.left) / rect.width) * PAGE_W),
      ),
      y: Math.max(
        0,
        Math.min(PAGE_H, ((e.clientY - rect.top) / rect.height) * PAGE_H),
      ),
      p: e.pressure > 0 ? Math.min(1, e.pressure) : fallbackPressure,
    };
  };
  const erase = (p: Point) => {
    working.current = eraseAlong(
      working.current,
      eraserPoint.current ?? p,
      p,
      15,
    );
    eraserPoint.current = p;
  };
  const appendPoint = (p: Point) => {
    const stroke = live.current;
    if (!stroke) {
      erase(p);
      return;
    }
    const last = stroke.points.at(-1)!;
    const minimum =
      stroke.tool === "marker" && stroke.points.length === 1 ? 2 : 0.4;
    if (Math.hypot(last.x - p.x, last.y - p.y) <= minimum) return;
    if (stroke.tool === "line") stroke.points = [stroke.points[0], p];
    else stroke.points.push(p);
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (
      disabled ||
      pointer.current !== null ||
      (e.pointerType === "touch" && !touchWriting) ||
      e.button > 0
    )
      return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = e.pointerId;
    working.current = base.current;
    const p = point(e, e.currentTarget.getBoundingClientRect());
    if (tool === "eraser") erase(p);
    else
      live.current = {
        id: uid(),
        tool,
        color,
        width: tool === "marker" ? width * 7 : width,
        points: [p],
      };
    redraw();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    e.preventDefault();
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const events = coalesced?.length ? coalesced : [e.nativeEvent];
    const rect = e.currentTarget.getBoundingClientRect();
    for (const event of events) appendPoint(point(event, rect));
    redraw();
  };
  const finish = (e: PointerEvent<HTMLCanvasElement>) => {
    if (pointer.current !== e.pointerId) return;
    if (e.type === "pointerup") {
      appendPoint(
        point(
          e,
          e.currentTarget.getBoundingClientRect(),
          live.current?.points.at(-1)?.p,
        ),
      );
    }
    const draft = live.current;
    const stroke =
      draft?.tool === "marker" && draft.points.length < 2 ? null : draft;
    const result = stroke ? [...working.current, stroke] : working.current;
    const changed = result !== base.current;
    const committed = committedCanvas.current?.getContext("2d");
    if (stroke && committed && painted.current === working.current) {
      drawStroke(committed, stroke);
      painted.current = result;
    }
    pointer.current = null;
    live.current = null;
    eraserPoint.current = null;
    base.current = result;
    working.current = result;
    paint();
    if (changed) onChange(result);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return (
    <div
      className={`paper paper-${paper} ${disabled ? "paper-disabled" : ""}`}
      style={{ width: `${zoom * 100}%` }}
    >
      <div className="paper-margin" />
      <canvas
        ref={committedCanvas}
        width={PAGE_W}
        height={PAGE_H}
        className="committed-ink"
        aria-hidden="true"
      />
      <canvas
        ref={canvas}
        width={PAGE_W}
        height={PAGE_H}
        aria-label={label}
        role="img"
        data-testid="ink-canvas"
        style={{
          touchAction: touchWriting ? "none" : "pan-x pan-y pinch-zoom",
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </div>
  );
}
