import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import {
  eraseAlong,
  eraseScratch,
  uid,
  type Point,
  type Stroke,
  type Paper,
} from "./model";
import { PAGE_H, PAGE_W, paintSvgStroke } from "./ink";
type PaperTouch = Touch & { touchType?: "direct" | "stylus" };
type Contact = {
  x: number;
  y: number;
  startX: number;
  startY: number;
  palm: boolean;
};
export type Tool = "pen" | "marker" | "eraser" | "line";
type Props = {
  strokes: Stroke[];
  onChange: (s: Stroke[]) => void;
  tool: Tool;
  color: string;
  width: number;
  scratchToErase?: boolean;
  onPageSwipe?: (direction: -1 | 1) => void;
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
  scratchToErase = false,
  onPageSwipe,
  paper,
  zoom = 1,
  label = "Schreibfläche",
  disabled = false,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    committedLayer = useRef<SVGGElement>(null),
    committedPaths = useRef(new Map<Stroke, SVGPathElement>()),
    previewPath = useRef<SVGPathElement>(null),
    painted = useRef<Stroke[] | null>(null),
    live = useRef<Stroke | null>(null),
    eraserPoint = useRef<Point | null>(null),
    base = useRef(strokes),
    pointer = useRef<number | null>(null),
    pointerType = useRef(""),
    touches = useRef(new Map<number, Contact>()),
    touchLocked = useRef(false),
    nativeHandledPointers = useRef(false),
    nativePairActive = useRef(false),
    pointerScroll = useRef({ x: 0, y: 0 }),
    lastPenUp = useRef(-Infinity),
    scratchStart = useRef<number | null>(null),
    frame = useRef(0),
    working = useRef<Stroke[]>(strokes);
  const change = useRef(onChange);
  change.current = onChange;
  const paint = () => {
    const layer = committedLayer.current;
    if (layer && painted.current !== working.current) {
      const owner = layer.ownerDocument;
      const fragment = owner.createDocumentFragment();
      const nextPaths = new Map<Stroke, SVGPathElement>();
      for (const stroke of working.current) {
        let path = committedPaths.current.get(stroke);
        if (!path) {
          path = owner.createElementNS("http://www.w3.org/2000/svg", "path");
          paintSvgStroke(path, stroke);
        }
        nextPaths.set(stroke, path);
        fragment.append(path);
      }
      layer.replaceChildren(fragment);
      committedPaths.current = nextPaths;
      painted.current = working.current;
    }
    if (previewPath.current) {
      if (live.current) paintSvgStroke(previewPath.current, live.current);
      else previewPath.current.removeAttribute("d");
    }
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
      stroke.tool === "marker" && stroke.points.length === 1
        ? 2
        : stroke.tool === "pen"
          ? 0.12
          : 0.4;
    if (Math.hypot(last.x - p.x, last.y - p.y) <= minimum) return;
    if (stroke.tool === "line") stroke.points = [stroke.points[0], p];
    else stroke.points.push(p);
  };
  const begin = (e: PointerEvent<HTMLCanvasElement>, p: Point) => {
    pointer.current = e.pointerId;
    pointerType.current = e.pointerType;
    scratchStart.current =
      scratchToErase && tool === "pen" ? e.timeStamp : null;
    working.current = base.current;
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
  const cancelFingerInk = () => {
    if (pointer.current === null || pointerType.current !== "touch") return;
    pointer.current = null;
    live.current = null;
    eraserPoint.current = null;
    working.current = base.current;
    redraw();
  };
  const fingers = () =>
    [...touches.current.values()].filter((touch) => !touch.palm);
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (disabled || e.button > 0) return;
    if (e.pointerType === "touch") {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      touches.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        palm:
          Math.min(e.width, e.height) > 42 ||
          (pointer.current !== null && pointerType.current !== "touch"),
      });
      if (nativePairActive.current) nativeHandledPointers.current = true;
      const pair = fingers();
      if (pair.length >= 2) {
        cancelFingerInk();
        touchLocked.current = true;
        pointerScroll.current = { x: 0, y: 0 };
        for (const contact of pair) {
          contact.startX = contact.x;
          contact.startY = contact.y;
        }
      }
      return;
    }
    if (e.pointerType === "pen") {
      cancelFingerInk();
      for (const contact of touches.current.values()) contact.palm = true;
      pointerScroll.current = { x: 0, y: 0 };
    }
    if (pointer.current !== null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    begin(e, point(e, e.currentTarget.getBoundingClientRect()));
  };
  const canTurnPage = Boolean(onPageSwipe) && zoom <= 1.01;
  const travel = ([first, second]: Contact[]) => {
    const ax = first.x - first.startX,
      ay = first.y - first.startY;
    const bx = second.x - second.startX,
      by = second.y - second.startY;
    return { ax, ay, bx, by, x: (ax + bx) / 2, y: (ay + by) / 2 };
  };
  const scrollWithFingers = (
    pair: Contact[],
    scroller: HTMLElement,
    previous: { x: number; y: number },
  ) => {
    const { ax, ay, bx, by, x, y } = travel(pair);
    if (
      Math.hypot(ax, ay) < 3 ||
      Math.hypot(bx, by) < 3 ||
      ax * bx + ay * by <= 0
    )
      return;
    if (canTurnPage && Math.abs(x) > Math.abs(y)) return;
    if (!canTurnPage) scroller.scrollLeft -= x - previous.x;
    scroller.scrollTop -= y - previous.y;
    previous.x = x;
    previous.y = y;
  };
  const turnPage = (pair: Contact[]) => {
    if (!canTurnPage) return;
    const { ax, bx, x, y } = travel(pair);
    if (
      Math.abs(x) >= 45 &&
      Math.abs(x) > Math.abs(y) * 1.25 &&
      Math.min(Math.abs(ax), Math.abs(bx)) >= 24 &&
      ax * bx > 0
    ) {
      onPageSwipe?.(x < 0 ? 1 : -1);
    }
  };

  const nativeGestures = useRef({
    cancelFingerInk,
    scrollWithFingers,
    turnPage,
    disabled,
  });
  nativeGestures.current = {
    cancelFingerInk,
    scrollWithFingers,
    turnPage,
    disabled,
  };

  useEffect(() => {
    const scroller = canvas.current?.closest<HTMLElement>(
      ".paper-scroll, .sample-surface",
    );
    if (!scroller) return;

    const contacts = new Map<number, Contact>();
    let previous = { x: 0, y: 0 };
    const movingPair = () =>
      [...contacts.entries()]
        .sort(
          ([, a], [, b]) =>
            Math.hypot(b.x - b.startX, b.y - b.startY) -
            Math.hypot(a.x - a.startX, a.y - a.startY),
        )
        .slice(0, 2);
    const track = (event: TouchEvent) => {
      if (nativeGestures.current.disabled) return;
      const localTouches = Array.from(
        event.changedTouches as ArrayLike<PaperTouch>,
      ).filter(
        (touch) =>
          touch.target instanceof window.Node &&
          scroller.contains(touch.target),
      );
      if (!localTouches.length) return;
      if (
        (event.type === "touchstart" || event.type === "touchmove") &&
        event.cancelable
      )
        event.preventDefault();
      const changes = localTouches.filter(
        (touch) => touch.touchType !== "stylus",
      );
      if (!changes.length) return;
      const finished =
        event.type === "touchend" || event.type === "touchcancel";
      const penActive =
        pointer.current !== null && pointerType.current === "pen";
      for (const { identifier: id, clientX: x, clientY: y } of changes) {
        if (event.type === "touchstart")
          contacts.set(id, { x, y, startX: x, startY: y, palm: false });
        const contact = contacts.get(id);
        if (contact) {
          contact.x = x;
          contact.y = y;
        }
      }
      if (penActive) {
        for (const contact of contacts.values()) {
          contact.startX = contact.x;
          contact.startY = contact.y;
        }
        previous = { x: 0, y: 0 };
      }
      if (finished) {
        const pair = movingPair();
        if (
          event.type === "touchend" &&
          !penActive &&
          nativePairActive.current &&
          pair.length === 2 &&
          changes.some((t) => pair.some(([id]) => id === t.identifier))
        ) {
          nativeGestures.current.turnPage(pair.map(([, contact]) => contact));
        }
        for (const { identifier } of changes) contacts.delete(identifier);
        if (!contacts.size) nativePairActive.current = false;
        return;
      }

      if (
        event.type === "touchstart" &&
        !nativePairActive.current &&
        contacts.size >= 2
      ) {
        nativePairActive.current = true;
        nativeHandledPointers.current = touches.current.size > 0;
        nativeGestures.current.cancelFingerInk();
        for (const contact of contacts.values()) {
          contact.startX = contact.x;
          contact.startY = contact.y;
        }
        previous = { x: 0, y: 0 };
      }
      if (event.type === "touchmove" && !penActive && contacts.size >= 2) {
        nativeGestures.current.scrollWithFingers(
          movingPair().map(([, contact]) => contact),
          scroller,
          previous,
        );
      }
    };
    const preventSelection = (event: Event) => event.preventDefault();
    const suppress = ["selectstart", "contextmenu", "dragstart"];
    for (const name of suppress)
      scroller.addEventListener(name, preventSelection);
    for (const name of [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const)
      scroller.addEventListener(name, track, { passive: false });
    return () => {
      for (const name of suppress)
        scroller.removeEventListener(name, preventSelection);
      for (const name of [
        "touchstart",
        "touchmove",
        "touchend",
        "touchcancel",
      ] as const)
        scroller.removeEventListener(name, track);
    };
  }, []);

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      const contact = touches.current.get(e.pointerId);
      if (!contact || contact.palm || nativePairActive.current) return;
      e.preventDefault();
      contact.x = e.clientX;
      contact.y = e.clientY;
      if (pointer.current !== null && pointerType.current !== "touch") return;
      const pair = fingers();
      if (pair.length === 2) {
        const scroller = e.currentTarget.closest<HTMLElement>(
          ".paper-scroll, .sample-surface",
        );
        if (scroller && !nativeHandledPointers.current)
          scrollWithFingers(pair, scroller, pointerScroll.current);
        return;
      }
      if (
        pair.length !== 1 ||
        touchLocked.current ||
        e.timeStamp - lastPenUp.current < 350
      )
        return;
      if (pointer.current === null) {
        if (
          Math.hypot(contact.x - contact.startX, contact.y - contact.startY) < 2
        )
          return;
        begin(
          e,
          point(
            {
              clientX: contact.startX,
              clientY: contact.startY,
              pressure: e.pressure,
            },
            e.currentTarget.getBoundingClientRect(),
          ),
        );
      }
    }
    if (pointer.current !== e.pointerId) return;
    e.preventDefault();
    const coalesced = e.nativeEvent.getCoalescedEvents?.();
    const rect = e.currentTarget.getBoundingClientRect();
    for (const event of coalesced ?? []) appendPoint(point(event, rect));
    appendPoint(point(e, rect));
    redraw();
  };
  const finish = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      const released = touches.current.get(e.pointerId);
      if (released && e.type === "pointerup") {
        released.x = e.clientX;
        released.y = e.clientY;
      }
      const pair = fingers();
      touches.current.delete(e.pointerId);
      const nativeOwnsGesture =
        nativePairActive.current || nativeHandledPointers.current;
      if (!touches.current.size) nativeHandledPointers.current = false;
      if (!fingers().length) touchLocked.current = false;
      if (
        !nativeOwnsGesture &&
        e.type === "pointerup" &&
        released &&
        !released.palm &&
        pair.length === 2
      )
        turnPage(pair);
      if (
        (nativeOwnsGesture || e.type !== "pointerup") &&
        pointer.current === e.pointerId
      )
        cancelFingerInk();
    }
    if (pointer.current !== e.pointerId) return;
    if (pointerType.current === "pen") lastPenUp.current = e.timeStamp;
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
    const before = working.current;
    if (draft && scratchStart.current !== null) {
      working.current = eraseScratch(
        before,
        draft.points,
        e.timeStamp - scratchStart.current,
      );
    }
    const stroke =
      before !== working.current ||
      (draft?.tool === "marker" && draft.points.length < 2)
        ? null
        : draft;
    const result = stroke ? [...working.current, stroke] : working.current;
    const changed = result !== base.current;
    pointer.current = null;
    scratchStart.current = null;
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
      <svg
        className="paper-ink"
        viewBox={`0 0 ${PAGE_W} ${PAGE_H}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g ref={committedLayer} />
        <path ref={previewPath} />
      </svg>
      <canvas
        ref={canvas}
        width={1}
        height={1}
        draggable={false}
        aria-label={label}
        role="img"
        data-testid="ink-canvas"
        style={{ touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </div>
  );
}
