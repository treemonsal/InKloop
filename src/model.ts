export type Point = { x: number; y: number; p: number };
export type Stroke = {
  id: string;
  tool: "pen" | "marker" | "line";
  color: string;
  width: number;
  points: Point[];
  flattened?: true;
};
export type Paper = "grid" | "ruled" | "dots" | "blank";
export type Page = {
  id: string;
  title: string;
  task: string;
  strokes: Stroke[];
  paper: Paper;
  language?: "de" | "en";
  updatedAt: number;
  submissions: Submission[];
};
export type Submission = {
  id: string;
  createdAt: number;
  strokes: Stroke[];
  task: string;
  transcription: string;
  feedback: string;
  nextTask: string;
  handoff?: {
    subject: string;
    language: Notebook["language"];
    samples: Sample[];
    sent: boolean;
  };
};
export type Notebook = {
  id: string;
  name: string;
  subject: string;
  color: string;
  language: "de" | "en";
  pages: Page[];
  lastPageId?: string;
  chatUrl: string;
  claudeUrl: string;
};
export type Sample = { id: string; label: string; strokes: Stroke[] };
export type AppData = {
  version: 1;
  bridgeCursor?: string;
  notebooks: Notebook[];
  activeNotebook: string;
  activePage: string;
  samples: Sample[];
  onboardingDone: boolean;
  settings: {
    provider: "chatgpt" | "claude";
    touchWriting: boolean;
    includeProfile: boolean;
    theme?: "dark" | "light";
  };
};
export const uid = () => crypto.randomUUID();
export function newPage(title = "Neue Seite"): Page {
  return {
    id: uid(),
    title,
    task: "",
    strokes: [],
    paper: "grid",
    updatedAt: Date.now(),
    submissions: [],
  };
}
export function receiveTask(
  data: AppData,
  notebookId: string,
  eventId: string,
  task: string,
  language?: Notebook["language"],
): AppData {
  const target = data.notebooks.find((n) => n.id === notebookId);
  if (!target || target.pages.some((p) => p.id === eventId)) return data;
  const page = {
    ...newPage(`Seite ${target.pages.length + 1}`),
    id: eventId,
    task,
  };
  return {
    ...data,
    notebooks: data.notebooks.map((n) =>
      n === target
        ? { ...n, language: language || n.language, pages: [...n.pages, page] }
        : n,
    ),
  };
}
export function newNotebook(
  name: string,
  subject = name,
  color = "#c49a73",
  language: "de" | "en" = "de",
): Notebook {
  return {
    id: uid(),
    name,
    subject,
    color,
    language,
    pages: [newPage("Seite 1")],
    chatUrl: "",
    claudeUrl: "",
  };
}
export function initialData(): AppData {
  const notebooks = [
    newNotebook("Mathematik", "Mathematik", "#c49a73"),
    newNotebook("Finanz- & Rechnungswesen", "FRW", "#8da995"),
    newNotebook("Wirtschaft & Recht", "Wirtschaft & Recht", "#a39abd"),
  ];
  return {
    version: 1,
    notebooks,
    activeNotebook: notebooks[0].id,
    activePage: notebooks[0].pages[0].id,
    samples: [],
    onboardingDone: false,
    settings: {
      provider: "chatgpt",
      touchWriting: false,
      includeProfile: true,
    },
  };
}
export function chatLink(
  value: string,
  provider: "chatgpt" | "claude",
): string {
  const fallback =
    provider === "chatgpt" ? "https://chatgpt.com/" : "https://claude.ai/";
  if (!value.trim()) return fallback;
  try {
    const u = new URL(value.trim());
    if (
      u.protocol === "https:" &&
      (u.hostname === "chatgpt.com" ||
        u.hostname === "chat.openai.com" ||
        u.hostname === "claude.ai") &&
      !u.username &&
      !u.password
    )
      return u.href;
  } catch {
    /* report below */
  }
  throw new Error(
    "Bitte einen HTTPS-Link von chatgpt.com oder claude.ai verwenden.",
  );
}
export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function interpolate(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    p: a.p + (b.p - a.p) * t,
  };
}

export function strokePath(stroke: Stroke): Point[] {
  const points = stroke.points;
  if (points.length <= 2 || stroke.flattened) return points;
  if (stroke.tool === "line") return [points[0], points.at(-1)!];

  let start = interpolate(points[0], points[1], 0.5);
  const path = [points[0], start];
  for (let i = 1; i < points.length - 1; i++) {
    const end = interpolate(points[i], points[i + 1], 0.5);
    // Sample each rounded corner so drawing and erasing share the same path.
    for (const t of [0.25, 0.5, 0.75, 1]) {
      path.push(
        interpolate(
          interpolate(start, points[i], t),
          interpolate(points[i], end, t),
          t,
        ),
      );
    }
    start = end;
  }
  path.push(points.at(-1)!);
  return path;
}

type Interval = [start: number, end: number];

function circleInterval(
  a: Point,
  b: Point,
  center: Point,
  radius: number,
): Interval | undefined {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const x = a.x - center.x,
    y = a.y - center.y;
  const lengthSquared = dx * dx + dy * dy;
  const offset = x * x + y * y - radius * radius;
  if (!lengthSquared) return offset < 0 ? [0, 1] : undefined;
  const projection = x * dx + y * dy;
  const discriminant = projection * projection - lengthSquared * offset;
  if (discriminant <= 0) return;
  const half = Math.sqrt(discriminant);
  const start = Math.max(0, (-projection - half) / lengthSquared);
  const end = Math.min(1, (-projection + half) / lengthSquared);
  if (start < end) return [start, end];
}

function bandInterval(
  a: number,
  b: number,
  min: number,
  max: number,
): Interval | undefined {
  if (a === b) return min <= a && a <= max ? [0, 1] : undefined;
  const t1 = (min - a) / (b - a),
    t2 = (max - a) / (b - a);
  const start = Math.max(0, Math.min(t1, t2)),
    end = Math.min(1, Math.max(t1, t2));
  if (start < end) return [start, end];
}

function capsuleInterval(
  a: Point,
  b: Point,
  from: Point,
  to: Point,
  radius: number,
): Interval | undefined {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return circleInterval(a, b, from, radius);

  // A sweep is a rectangle with a round cap at either end.
  const along = (p: Point) =>
    ((p.x - from.x) * dx + (p.y - from.y) * dy) / length;
  const across = (p: Point) =>
    ((p.y - from.y) * dx - (p.x - from.x) * dy) / length;
  const x = bandInterval(along(a), along(b), 0, length);
  const y = bandInterval(across(a), across(b), -radius, radius);
  const intervals = [
    circleInterval(a, b, from, radius),
    circleInterval(a, b, to, radius),
  ];
  if (x && y && Math.max(x[0], y[0]) < Math.min(x[1], y[1]))
    intervals.push([Math.max(x[0], y[0]), Math.min(x[1], y[1])]);
  const hits = intervals.filter((interval): interval is Interval =>
    Boolean(interval),
  );
  if (hits.length)
    return [
      Math.min(...hits.map((i) => i[0])),
      Math.max(...hits.map((i) => i[1])),
    ];
}

export function eraseAlong(
  strokes: Stroke[],
  from: Point,
  to: Point,
  radius: number,
): Stroke[] {
  let changed = false;
  const remaining = strokes.flatMap((stroke) => {
    const padding =
      radius + stroke.width * (stroke.tool === "pen" ? 0.675 : 0.5);
    const left = Math.min(from.x, to.x) - padding,
      right = Math.max(from.x, to.x) + padding;
    const top = Math.min(from.y, to.y) - padding,
      bottom = Math.max(from.y, to.y) + padding;
    const raw = stroke.points;
    if (
      raw.every((p) => p.x < left) ||
      raw.every((p) => p.x > right) ||
      raw.every((p) => p.y < top) ||
      raw.every((p) => p.y > bottom)
    )
      return [stroke];

    const points = strokePath(stroke);
    if (points.length === 1) {
      if (distanceToSegment(points[0], from, to) >= padding) return [stroke];
      changed = true;
      return [];
    }
    let hit = false;
    let part = [points[0]];
    const parts: Point[][] = [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i];
      const cut = capsuleInterval(a, b, from, to, padding);
      if (!cut) {
        if (!part.length) part.push(a);
        part.push(b);
        continue;
      }
      hit = true;
      const [start, end] = cut;
      if (start > 0) {
        if (!part.length) part.push(a);
        part.push(interpolate(a, b, start));
      }
      if (part.length >= 2) parts.push(part);
      part = end < 1 ? [interpolate(a, b, end), b] : [];
    }
    if (!hit) return [stroke];
    if (part.length >= 2) parts.push(part);
    changed = true;
    return parts.map((points, i) => ({
      ...stroke,
      id: i === 0 ? stroke.id : uid(),
      points,
      flattened: true as const,
    }));
  });
  return changed ? remaining : strokes;
}

function eraseScratchedWords(
  strokes: Stroke[],
  from: Point,
  to: Point,
  radius: number,
) {
  const clipped = eraseAlong(strokes, from, to, radius);
  if (clipped === strokes) return strokes;

  const glyphs = strokes
    .flatMap((stroke) => {
      if (stroke.tool !== "pen" || !stroke.points.length) return [];
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;
      for (const { x, y } of stroke.points) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      const height = bottom - top;
      if (right - left > Math.max(34, height * 11) || height > 64) return [];
      return [{ stroke, left, right, top, bottom, height }];
    })
    .sort((a, b) => a.left - b.left);

  const survivors = new Set(clipped);
  const words = new Set<Stroke>();
  for (const anchor of glyphs) {
    if (survivors.has(anchor.stroke) || words.has(anchor.stroke)) continue;
    const height = Math.max(12, Math.min(34, anchor.height));
    const gap = Math.max(5, Math.min(12, height * 0.42));
    const row = glyphs.filter(
      (g) =>
        g.height <= height * 1.8 &&
        g.bottom >= anchor.top - height * 0.35 &&
        g.top <= anchor.bottom + height * 0.35 &&
        Math.abs(g.top + g.bottom - (anchor.top + anchor.bottom)) <=
          height * 1.4,
    );
    const index = row.indexOf(anchor);
    if (index < 0) continue;
    let start = 0,
      end = 0;
    while (end < row.length) {
      start = end;
      let right = row[end++].right;
      while (end < row.length && row[end].left - right <= gap) {
        right = Math.max(right, row[end++].right);
      }
      if (index < end) break;
    }
    const word = row.slice(start, end);
    if (
      word.length > 1 ||
      (anchor.height >= 7 && anchor.stroke.points.length >= 5)
    ) {
      for (const glyph of word) words.add(glyph.stroke);
      const left = word[0].left;
      const right = Math.max(...word.map((glyph) => glyph.right));
      const top = Math.min(...word.map((glyph) => glyph.top));
      for (const glyph of glyphs) {
        if (
          glyph.left >= left &&
          glyph.right <= right &&
          glyph.height <= 4 &&
          glyph.right - glyph.left <= 6 &&
          glyph.bottom < top &&
          top - glyph.bottom <= height * 0.68
        ) {
          words.add(glyph.stroke);
        }
      }
    }
  }
  return words.size
    ? eraseAlong(
        strokes.filter((stroke) => !words.has(stroke)),
        from,
        to,
        radius,
      )
    : clipped;
}

export function eraseScratch(
  strokes: Stroke[],
  points: Point[],
  duration: number,
) {
  if (!strokes.length || points.length < 4 || duration > 1650) return strokes;

  // Look for three overlapping sweeps, independent of the writing angle.
  for (let axis = 0; axis < 8; axis++) {
    const angle = (axis * Math.PI) / 8;
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const projected = points.map(({ x, y }) => ({
      along: x * dx + y * dy,
      across: y * dx - x * dy,
    }));
    const turns = [0];
    let extreme = 0;
    let direction = 0;
    for (let i = 1; i < projected.length; i++) {
      const delta = projected[i].along - projected[extreme].along;
      if (!direction) {
        if (Math.abs(delta) >= 7) {
          direction = Math.sign(delta);
          extreme = i;
        }
      } else if (delta * direction > 0) {
        extreme = i;
      } else if (delta * direction <= -7) {
        turns.push(extreme);
        direction = -direction;
        extreme = i;
      }
    }
    if (extreme !== turns.at(-1)) turns.push(extreme);

    for (let i = 3; i < turns.length; i++) {
      const [a, b, c, d] = turns.slice(i - 3, i + 1);
      const edges = [a, b, c, d].map((j) => projected[j].along);
      const low = Math.max(
        Math.min(edges[0], edges[1]),
        Math.min(edges[1], edges[2]),
        Math.min(edges[2], edges[3]),
      );
      const high = Math.min(
        Math.max(edges[0], edges[1]),
        Math.max(edges[1], edges[2]),
        Math.max(edges[2], edges[3]),
      );
      if (high - low < 13 || high - low > 420) continue;

      // Restrict the erase corridor to the part crossed in all three sweeps.
      let top = Infinity,
        bottom = -Infinity;
      for (let j = a + 1; j <= d; j++) {
        const before = projected[j - 1],
          after = projected[j];
        const range = bandInterval(before.along, after.along, low, high);
        if (!range) continue;
        const [from, to] = range;
        const start = before.across + (after.across - before.across) * from;
        const end = before.across + (after.across - before.across) * to;
        top = Math.min(top, start, end);
        bottom = Math.max(bottom, start, end);
      }
      const height = bottom - top;
      if (height > Math.min(38, (high - low) * 0.76)) continue;
      const middle = (top + bottom) / 2;
      const radius = Math.min((high - low) / 2, height / 2 + 7);
      const at = (u: number): Point => ({
        x: u * dx - middle * dy,
        y: u * dy + middle * dx,
        p: 0.5,
      });
      const erased = eraseScratchedWords(
        strokes,
        at(low + radius),
        at(high - radius),
        radius,
      );
      if (erased !== strokes) return erased;
    }
  }
  return strokes;
}

export function eraseAt(
  strokes: Stroke[],
  point: Point,
  radius: number,
): Stroke[] {
  return eraseAlong(strokes, point, point, radius);
}
const record = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === "object" && !Array.isArray(x);
export const MAX_TEXT_LENGTH = 200_000;
const string = (x: unknown, max = MAX_TEXT_LENGTH): x is string =>
  typeof x === "string" && x.length <= max;
const finite = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);
function validStrokes(x: unknown): x is Stroke[] {
  return (
    Array.isArray(x) &&
    x.every(
      (s) =>
        record(s) &&
        string(s.id, 100) &&
        (s.flattened === undefined || s.flattened === true) &&
        ["pen", "marker", "line"].includes(s.tool as string) &&
        typeof s.color === "string" &&
        /^#[\da-f]{6}$/i.test(s.color) &&
        finite(s.width) &&
        s.width > 0 &&
        s.width <= 40 &&
        Array.isArray(s.points) &&
        s.points.length > 0 &&
        s.points.every(
          (p) =>
            record(p) &&
            finite(p.x) &&
            finite(p.y) &&
            p.x >= -100 &&
            p.x <= 1000 &&
            p.y >= -100 &&
            p.y <= 1300 &&
            finite(p.p) &&
            p.p >= 0 &&
            p.p <= 1,
        ),
    )
  );
}
function validSubmission(s: unknown): s is Submission {
  return (
    record(s) &&
    string(s.id, 100) &&
    finite(s.createdAt) &&
    validStrokes(s.strokes) &&
    string(s.task) &&
    typeof s.transcription === "string" &&
    string(s.feedback) &&
    string(s.nextTask) &&
    (s.handoff === undefined ||
      (record(s.handoff) &&
        string(s.handoff.subject, 150) &&
        (s.handoff.language === "de" || s.handoff.language === "en") &&
        typeof s.handoff.sent === "boolean" &&
        Array.isArray(s.handoff.samples) &&
        s.handoff.samples.length <= 50 &&
        s.handoff.samples.every(validSample)))
  );
}
function validSample(s: unknown): s is Sample {
  return (
    record(s) &&
    string(s.id, 100) &&
    string(s.label, 1000) &&
    validStrokes(s.strokes)
  );
}
export function parseBackup(raw: string, maxSize = Infinity): AppData {
  if (raw.length > maxSize)
    throw new Error("Die Sicherung überschreitet die erlaubte Grösse.");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Diese Datei ist keine gültige Inkloop-Sicherung.");
  }
  return validateData(value);
}
export function validateData(d: unknown): AppData {
  if (
    !record(d) ||
    d.version !== 1 ||
    (d.bridgeCursor !== undefined && !string(d.bridgeCursor, 100)) ||
    !Array.isArray(d.notebooks) ||
    !string(d.activeNotebook, 100) ||
    !string(d.activePage, 100) ||
    typeof d.onboardingDone !== "boolean" ||
    !record(d.settings) ||
    !["chatgpt", "claude"].includes(d.settings.provider as string) ||
    typeof d.settings.touchWriting !== "boolean" ||
    typeof d.settings.includeProfile !== "boolean" ||
    (d.settings.theme !== undefined &&
      d.settings.theme !== "dark" &&
      d.settings.theme !== "light") ||
    !Array.isArray(d.samples) ||
    d.samples.length > 50
  )
    throw new Error("Die Sicherung hat ein unbekanntes Format.");
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  if (
    !d.notebooks.every(
      (n) =>
        record(n) &&
        string(n.id, 100) &&
        unique(n.id) &&
        string(n.name, 150) &&
        string(n.subject, 150) &&
        typeof n.color === "string" &&
        /^#[\da-f]{6}$/i.test(n.color) &&
        ["de", "en"].includes(n.language as string) &&
        string(n.claudeUrl, 2000) &&
        (!n.claudeUrl ||
          (() => {
            try {
              chatLink(n.claudeUrl as string, "claude");
              return true;
            } catch {
              return false;
            }
          })()) &&
        string(n.chatUrl, 2000) &&
        (!n.chatUrl ||
          (() => {
            try {
              chatLink(n.chatUrl as string, "chatgpt");
              return true;
            } catch {
              return false;
            }
          })()) &&
        (n.lastPageId === undefined || string(n.lastPageId, 100)) &&
        Array.isArray(n.pages) &&
        n.pages.length > 0 &&
        n.pages.every(
          (p) =>
            record(p) &&
            string(p.id, 100) &&
            unique(p.id) &&
            string(p.title, 150) &&
            string(p.task) &&
            (p.language === undefined ||
              p.language === "de" ||
              p.language === "en") &&
            validStrokes(p.strokes) &&
            ["grid", "ruled", "dots", "blank"].includes(p.paper as string) &&
            finite(p.updatedAt) &&
            Array.isArray(p.submissions) &&
            p.submissions.every((s) => validSubmission(s) && unique(s.id)),
        ),
    )
  )
    throw new Error("Die Sicherung enthält ungültige Lernhefte oder Seiten.");
  if (!d.samples.every((s) => validSample(s) && unique(s.id)))
    throw new Error("Die Handschriftreferenzen sind ungültig.");
  const result = d as unknown as AppData;
  if (!result.notebooks.length && !result.activeNotebook && !result.activePage)
    return result;
  const active = result.notebooks.find((n) => n.id === result.activeNotebook);
  if (!active || !active.pages.some((p) => p.id === result.activePage))
    throw new Error("Die aktive Seite fehlt in der Sicherung.");
  return result;
}
export function parseResponse(raw: string): {
  transcription: string;
  feedback: string;
  nextTask: string;
} {
  if (raw.length > MAX_TEXT_LENGTH) throw new Error("Die Antwort ist zu lang.");
  const clean = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const value: unknown = JSON.parse(clean);
    if (
      record(value) &&
      typeof value.transcription === "string" &&
      typeof value.feedback === "string" &&
      (value.next_task === undefined || typeof value.next_task === "string")
    )
      return {
        transcription: value.transcription,
        feedback: value.feedback,
        nextTask: (value.next_task as string) || "",
      };
  } catch {
    /* plain text remains useful */
  }
  return { transcription: "", feedback: raw.trim(), nextTask: "" };
}
export function buildPrompt(n: Notebook, s: Submission, sampleCount: number) {
  return `INKLOOP · Lernsession · Abgabe ${s.id}\nFach: ${n.subject}\nSprache: ${n.language === "en" ? "English" : "Deutsch"} (Fachbegriffe und Zitate in der Originalsprache erhalten).\n${s.task ? `Aufgabe:\n${s.task}\n` : "Die Aufgabe ergibt sich aus unserem bisherigen Chat. Falls sie fehlt, frage danach.\n"}\nDas angehängte Bild zeigt zuerst MEINE ANTWORT. ${sampleCount ? `Darunter folgen ${sampleCount} beschriftete Handschriftreferenzen. Verwende diese nur als Lesehilfe, NICHT als Teil der Antwort. Das ist kein trainiertes persönliches Modell.` : ""}\n1. Transkribiere meine Antwort originalgetreu. Korrigiere dabei KEINE fachlichen Fehler oder Rechenfehler. Markiere unlesbare Stellen mit [unklar: …], statt zu raten. Erhalte Tabellen, Soll/Haben-Spalten, Einheiten, Vorzeichen, Brüche und Mindmap-Verbindungen. Nutze Markdown-Tabellen und LaTeX, wo sinnvoll. Beschreibe räumliche Beziehungen, wenn Text allein nicht reicht.\n2. Gib erst DANACH fachliches Feedback. Unterscheide Lesefehler von Lösungsfehlern. Nutze den Kontext dieses Chats. Bei mehrdeutigen Zeichen frage nach, bevor du eine Lösung als falsch bewertest.\n3. Begleite mich als Tutor: erst ein hilfreicher Hinweis, nicht sofort die gesamte Musterlösung.\nAntworte bitte als genau ein JSON-Codeblock mit String-Feldern (Zeilenumbrüche als \\n; Backslashes in LaTeX als \\\\ escapen):\n{"transcription":"originalgetreue Abschrift", "feedback":"deine Erklärung", "next_task":"nächste Aufgabe oder leere Zeichenfolge"}\nSo kann ich deine Antwort direkt zurück in mein Lernheft kopieren.`;
}
