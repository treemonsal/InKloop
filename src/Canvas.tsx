import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";
import {
  eraseAlong,
  eraseScratch,
  uid,
  type Point,
  type Stroke,
  type Paper,
} from "./model";
import { PAGE_H, PAGE_W, drawStroke, renderInk } from "./ink";
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
    committedCanvas = useRef<HTMLCanvasElement>(null),
    painted = useRef<Stroke[] | null>(null),
    live = useRef<Stroke | null>(null),
    eraserPoint = useRef<Point | null>(null),
    base = useRef(strokes),
    pointer = useRef<number | null>(null),
    pointerType = useRef(""),
    touches = useRef(new Map<number, Contact>()),
    touchLocked = useRef(false),
    touchEventsSeen = useRef(false),
    nativePairActive = useRef(false),
    pointerScroll = useRef({ x: 0, y: 0 }),
    lastPenUp = useRef(-Infinity),
    scratchStart = useRef<number | null>(null),
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
  useLayoutEffect(() => {
    const front = canvas.current;
    const back = committedCanvas.current;
    if (!front || !back) return;

    const resize = () => {
      const { width } = front.getBoundingClientRect();
      if (!width) return;
      const scale = Math.max(
        1,
        Math.min(2.5, (width * window.devicePixelRatio) / PAGE_W),
      );
      const pixelsWide = Math.round(PAGE_W * scale);
      const pixelsHigh = Math.round(PAGE_H * scale);
      if (front.width === pixelsWide && front.height === pixelsHigh) return;
      for (const layer of [front, back]) {
        layer.width = pixelsWide;
        layer.height = pixelsHigh;
      }
      painted.current = null;
      paint();
    };

    resize();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : undefined;
    observer?.observe(front);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);
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
    if (pointerType.current !== "touch") return;
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
    const pair = () =>
      [...contacts.values()].filter((contact) => !contact.palm);
    const track = (event: TouchEvent) => {
      if (nativeGestures.current.disabled) return;
      const changes = Array.from(
        event.changedTouches as ArrayLike<PaperTouch>,
      ).filter(
        (touch) =>
          touch.touchType !== "stylus" &&
          touch.target instanceof window.Node &&
          scroller.contains(touch.target),
      );
      if (!changes.length) return;
      touchEventsSeen.current = true;
      const oldPair = pair();
      const finished =
        event.type === "touchend" || event.type === "touchcancel";
      const penActive =
        pointer.current !== null && pointerType.current === "pen";
      if (penActive)
        for (const contact of contacts.values()) contact.palm = true;
      let releasedFinger = false;
      for (const touch of changes) {
        const { identifier: id, clientX: x, clientY: y } = touch;
        if (event.type === "touchstart") {
          contacts.set(id, {
            x,
            y,
            startX: x,
            startY: y,
            palm: penActive || Math.min(touch.radiusX, touch.radiusY) > 21,
          });
        }
        const contact = contacts.get(id);
        if (contact) {
          contact.x = x;
          contact.y = y;
        }
        if (finished) {
          if (contact && !contact.palm) releasedFinger = true;
          contacts.delete(id);
        }
      }
      if (finished) {
        if (
          event.type === "touchend" &&
          !penActive &&
          releasedFinger &&
          oldPair.length === 2
        ) {
          nativeGestures.current.turnPage(oldPair);
        }
        if (pair().length === 0) nativePairActive.current = false;
        return;
      }

      const currentPair = pair();
      if (event.type === "touchstart" && currentPair.length >= 2) {
        nativePairActive.current = true;
        nativeGestures.current.cancelFingerInk();
        for (const contact of currentPair) {
          contact.startX = contact.x;
          contact.startY = contact.y;
        }
        previous = { x: 0, y: 0 };
      }
      if (event.type === "touchmove") {
        if (event.cancelable) event.preventDefault();
        if (!penActive && currentPair.length === 2)
          nativeGestures.current.scrollWithFingers(
            currentPair,
            scroller,
            previous,
          );
      }
    };
    for (const name of [
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
    ] as const)
      scroller.addEventListener(name, track, { passive: false });
    return () => {
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
        if (scroller && !touchEventsSeen.current)
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
      if (!fingers().length) touchLocked.current = false;
      if (
        !touchEventsSeen.current &&
        e.type === "pointerup" &&
        released &&
        !released.palm &&
        pair.length === 2
      )
        turnPage(pair);
      if (
        (nativePairActive.current || e.type !== "pointerup") &&
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
    const committed = committedCanvas.current?.getContext("2d");
    if (stroke && committed && painted.current === working.current) {
      drawStroke(committed, stroke);
      painted.current = result;
    }
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
