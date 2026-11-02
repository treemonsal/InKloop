import type { AppData, Notebook, Point, Stroke, Submission } from "./model";
export const PAGE_W = 900,
  PAGE_H = 1200;
const colorMap: Record<string, string> = {
  "#eee9df": "#242622",
  "#bfcaaf": "#4b633c",
  "#dfb18a": "#965724",
  "#a9bed7": "#315b88",
  "#c1acd6": "#704d91",
};
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  light = false,
) {
  if (!s.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = light ? colorMap[s.color] || s.color : s.color;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.globalAlpha = s.tool === "marker" ? 0.28 : 1;
  const pts = s.points;
  const width = (p: Point) =>
    s.width * (s.tool === "pen" ? 0.55 + 0.8 * p.p : 1);
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, width(pts[0]) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.tool === "line") {
    ctx.lineWidth = s.width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  } else {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        b = pts[i];
      ctx.lineWidth = (width(a) + width(b)) / 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
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
  data: AppData,
): Promise<Blob> {
  const samples = data.settings.includeProfile ? data.samples : [];
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
