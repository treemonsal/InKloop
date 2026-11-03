export type Point = { x: number; y: number; p: number };
export type Stroke = {
  id: string;
  tool: "pen" | "marker" | "line";
  color: string;
  width: number;
  points: Point[];
};
export type Paper = "grid" | "ruled" | "dots" | "blank";
export type Page = {
  id: string;
  title: string;
  task: string;
  strokes: Stroke[];
  paper: Paper;
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
export function eraseAt(strokes: Stroke[], p: Point, radius: number) {
  return strokes.filter(
    (s) =>
      !s.points.some(
        (a, i) =>
          distanceToSegment(p, a, s.points[i + 1] || a) < radius + s.width / 2,
      ),
  );
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
    !d.notebooks.length ||
    !string(d.activeNotebook, 100) ||
    !string(d.activePage, 100) ||
    typeof d.onboardingDone !== "boolean" ||
    !record(d.settings) ||
    !["chatgpt", "claude"].includes(d.settings.provider as string) ||
    typeof d.settings.touchWriting !== "boolean" ||
    typeof d.settings.includeProfile !== "boolean" ||
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
