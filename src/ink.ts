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
  "#3976e8": "#2458ac",
  "#eee9df": "#242622",
  "#bfcaaf": "#4b633c",
  "#dfb18a": "#965724",
  "#a9bed7": "#315b88",
  "#c1acd6": "#704d91",
};
export function displayInkColor(color: string, light: boolean) {
  if (!light) return color;
  if (color === "#f4f5f7") return "#141413";
  if (color === "#a9abb2") return "#5e5d59";
  if (color === "#3976e8") return "#963f29";
  return colorMap[color] || color;
}

type PathWriter = Pick<
  CanvasRenderingContext2D,
  "moveTo" | "lineTo" | "quadraticCurveTo" | "closePath"
> & {
  circle(x: number, y: number, radius: number): void;
};

function traceCurve(ctx: PathWriter, points: Point[]) {
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

function penRadius(point: Point, width: number) {
  return (width * (0.7 + 0.65 * point.p)) / 2;
}

function fillPenStroke(ctx: PathWriter, points: Point[], width: number) {
  // Rounded discs and the connections between them share the same winding.
  // Even a tight curl can then overlap itself without cutting a hole in the ink.
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const radius = penRadius(point, width);
    ctx.circle(point.x, point.y, radius);

    const next = points[i + 1];
    if (!next) break;
    const dx = next.x - point.x,
      dy = next.y - point.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const nx = -dy / length,
      ny = dx / length;
    const nextRadius = penRadius(next, width);
    ctx.moveTo(point.x + nx * radius, point.y + ny * radius);
    ctx.lineTo(point.x - nx * radius, point.y - ny * radius);
    ctx.lineTo(next.x - nx * nextRadius, next.y - ny * nextRadius);
    ctx.lineTo(next.x + nx * nextRadius, next.y + ny * nextRadius);
    ctx.closePath();
  }
}

function traceStroke(path: PathWriter, stroke: Stroke) {
  const points = stroke.tool === "pen" ? strokePath(stroke) : stroke.points;
  if (!points.length || (stroke.tool === "marker" && points.length < 2)) return;
  const first = points[0];
  if (points.length === 1) {
    path.circle(
      first.x,
      first.y,
      stroke.tool === "pen" ? penRadius(first, stroke.width) : stroke.width / 2,
    );
    return "fill";
  }
  if (stroke.tool === "pen") {
    fillPenStroke(path, points, stroke.width);
    return "fill";
  }
  path.moveTo(first.x, first.y);
  if (stroke.tool === "marker" && !stroke.flattened) {
    traceCurve(path, stroke.points);
  } else {
    for (const point of points.slice(1)) path.lineTo(point.x, point.y);
  }
  return "stroke";
}

export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  light = false,
  color = light ? colorMap[stroke.color] || stroke.color : stroke.color,
) {
  ctx.save();
  ctx.lineCap = stroke.tool === "marker" ? "butt" : "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = stroke.tool === "marker" ? 0.28 : 1;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  const paint = traceStroke(
    {
      moveTo: (x, y) => ctx.moveTo(x, y),
      lineTo: (x, y) => ctx.lineTo(x, y),
      quadraticCurveTo: (x, y, endX, endY) =>
        ctx.quadraticCurveTo(x, y, endX, endY),
      closePath: () => ctx.closePath(),
      circle: (x, y, radius) => {
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      },
    },
    stroke,
  );
  if (paint) ctx[paint]();
  ctx.restore();
}

export function paintSvgStroke(path: SVGPathElement, stroke: Stroke) {
  const commands: string[] = [];
  const point = (...values: number[]) =>
    values.map((n) => Math.round(n * 1000) / 1000).join(" ");
  const paint = traceStroke(
    {
      moveTo: (x, y) => commands.push("M" + point(x, y)),
      lineTo: (x, y) => commands.push("L" + point(x, y)),
      quadraticCurveTo: (x, y, endX, endY) =>
        commands.push("Q" + point(x, y, endX, endY)),
      closePath: () => commands.push("Z"),
      circle: (x, y, r) => {
        const radius = point(r, r);
        commands.push(
          "M" + point(x + r, y),
          "A" + radius + " 0 1 1 " + point(x - r, y),
          "A" + radius + " 0 1 1 " + point(x + r, y),
          "Z",
        );
      },
    },
    stroke,
  );
  path.setAttribute("d", commands.join(""));
  path.style.setProperty("--ink-light", displayInkColor(stroke.color, true));
  const color = `var(--ink-display, ${stroke.color})`;
  path.setAttribute("fill", paint === "fill" ? color : "none");
  path.setAttribute("stroke", paint === "stroke" ? color : "none");
  path.setAttribute("stroke-width", String(stroke.width));
  path.setAttribute(
    "stroke-linecap",
    stroke.tool === "marker" ? "butt" : "round",
  );
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("opacity", stroke.tool === "marker" ? "0.28" : "1");
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
export function thumbnail(
  canvas: HTMLCanvasElement,
  strokes: Stroke[],
  light: boolean,
) {
  canvas.width = 180;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(0.2, 0.2);
  for (const s of strokes)
    drawStroke(ctx, s, false, displayInkColor(s.color, light));
}
