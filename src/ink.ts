import {
  strokePath,
  type Notebook,
  type Point,
  type Sample,
  type Stroke,
  type Submission,
} from "./model";
export const PAGE_W = 900,
  PAGE_H = 1200;
const colorMap: Record<string, string> = {
  "#f4f5f7": "#222329",
  "#a9abb2": "#5c6069",
  "#a7c4ff": "#30518f",
  "#eee9df": "#242622",
  "#bfcaaf": "#4b633c",
  "#dfb18a": "#965724",
  "#a9bed7": "#315b88",
  "#c1acd6": "#704d91",
};
function traceCurve(ctx: CanvasRenderingContext2D, points: Point[]) {
  if (points.length > 2) {
    const [first, second] = points;
    ctx.lineTo((first.x + second.x) / 2, (first.y + second.y) / 2);
  }
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i],
      b = points[i + 1];
    ctx.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
  const end = points.at(-1)!;
  ctx.lineTo(end.x, end.y);
}

function penOutline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  width: number,
) {
  const sides = points.map((point, i) => {
    const before = points[Math.max(0, i - 1)],
      after = points[Math.min(points.length - 1, i + 1)];
    const dx = after.x - before.x,
      dy = after.y - before.y;
    const angle = Math.atan2(dy, dx) + Math.PI / 2;
    const radius = (width * (0.55 + 0.8 * point.p)) / 2;
    const x = Math.cos(angle) * radius,
      y = Math.sin(angle) * radius;
    return {
      point,
      angle,
      radius,
      outer: { ...point, x: point.x + x, y: point.y + y },
      inner: { ...point, x: point.x - x, y: point.y - y },
    };
  });
  const first = sides[0],
    last = sides.at(-1)!;
  ctx.moveTo(first.outer.x, first.outer.y);
  traceCurve(
    ctx,
    sides.map((side) => side.outer),
  );
  ctx.arc(
    last.point.x,
    last.point.y,
    last.radius,
    last.angle,
    last.angle - Math.PI,
    true,
  );
  traceCurve(
    ctx,
    sides.reverse().map((side) => side.inner),
  );
  ctx.arc(
    first.point.x,
    first.point.y,
    first.radius,
    first.angle - Math.PI,
    first.angle - 2 * Math.PI,
    true,
  );
  ctx.closePath();
  ctx.fill();
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  light = false,
) {
  const points = stroke.tool === "pen" ? strokePath(stroke) : stroke.points;
  if (!points.length || (stroke.tool === "marker" && points.length < 2)) return;
  ctx.save();
  ctx.lineCap = stroke.tool === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = light
    ? colorMap[stroke.color] || stroke.color
    : stroke.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = stroke.tool === "marker" ? 0.28 : 1;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();

  const first = points[0];
  if (points.length === 1) {
    const pressure = stroke.tool === "pen" ? 0.55 + 0.8 * first.p : 1;
    ctx.arc(first.x, first.y, (stroke.width * pressure) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (stroke.tool === "pen") {
    penOutline(ctx, points, stroke.width);
  } else {
    ctx.moveTo(first.x, first.y);
    if (stroke.tool === "marker" && !stroke.flattened) {
      traceCurve(ctx, stroke.points);
    } else {
      for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}
export function renderInk(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  live?: Stroke,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, PAGE_W, PAGE_H);
  for (const s of strokes) drawStroke(ctx, s);
  if (live) drawStroke(ctx, live);
}
function wrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  line = 26,
) {
  let top = y;
  for (const paragraph of text.split("\n")) {
    let row = "";
    for (const word of paragraph.split(" ")) {
      const test = row ? row + " " + word : word;
      if (ctx.measureText(test).width > maxWidth && row) {
        ctx.fillText(row, x, top);
        top += line;
        row = word;
      } else row = test;
    }
    ctx.fillText(row, x, top);
    top += line;
  }
  return top;
}
export async function submissionImage(
  n: Notebook,
  s: Submission,
  samples: Sample[],
): Promise<Blob> {
  const height = 1360 + samples.length * 240;
  const canvas = document.createElement("canvas");
  canvas.width = 1000;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Das Seitenbild konnte nicht erstellt werden.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1000, height);
  ctx.fillStyle = "#252923";
  ctx.font = "600 22px system-ui";
  ctx.fillText(`INKLOOP · ${n.subject}`, 50, 48);
  ctx.font = "15px system-ui";
  ctx.fillStyle = "#666";
  ctx.fillText("MEINE ANTWORT · Handschrift unverändert", 50, 78);
  ctx.save();
  ctx.translate(50, 110);
  for (const st of s.strokes) drawStroke(ctx, st, true);
  ctx.restore();
  let y = 1360;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    ctx.fillStyle = "#f3f3ef";
    ctx.fillRect(0, y, 1000, 240);
    ctx.fillStyle = "#444";
    ctx.font = "600 17px system-ui";
    wrappedText(
      ctx,
      `REFERENZ ${i + 1} · Vorgabe: ${sample.label}`,
      35,
      y + 30,
      930,
      24,
    );
    if (sample.strokes.length) {
      const { x0: minX, y0: minY, x1: maxX, y1: maxY } = bounds(sample.strokes);
      const scale = Math.min(
        930 / Math.max(100, maxX - minX),
        130 / Math.max(50, maxY - minY),
      );
      ctx.save();
      ctx.translate(35, y + 86);
      ctx.scale(scale, scale);
      ctx.translate(-minX + 10, -minY + 10);
      for (const st of sample.strokes) drawStroke(ctx, st, true);
      ctx.restore();
    }
    y += 240;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Bildexport fehlgeschlagen."))),
      "image/png",
    ),
  );
}
export function bounds(strokes: Stroke[]) {
  let x0 = PAGE_W,
    y0 = PAGE_H,
    x1 = 0,
    y1 = 0;
  for (const s of strokes)
    for (const p of s.points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  return { x0, y0, x1, y1 };
}
export function thumbnail(canvas: HTMLCanvasElement, strokes: Stroke[]) {
  canvas.width = 180;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(0.2, 0.2);
  for (const s of strokes) drawStroke(ctx, s);
}
