import type { BridgeEvent } from "./bridge";
import {
  receiveTask,
  type AppData,
  type Notebook,
  type Page,
  type Submission,
} from "./model";

// Immutable helpers. Untouched notebooks and pages keep their identity, which
// lets storage write only the pages that actually changed.
export function mapNotebook(
  d: AppData,
  id: string,
  fn: (n: Notebook) => Notebook,
): AppData {
  return {
    ...d,
    notebooks: d.notebooks.map((n) => (n.id === id ? fn(n) : n)),
  };
}

export function mapPage(
  d: AppData,
  notebookId: string,
  pageId: string,
  fn: (p: Page) => Page,
): AppData {
  return mapNotebook(d, notebookId, (n) => ({
    ...n,
    pages: n.pages.map((p) => (p.id === pageId ? fn(p) : p)),
  }));
}

export function findPage(d: AppData, pageId: string) {
  for (const n of d.notebooks)
    for (const p of n.pages)
      if (p.id === pageId) return { notebook: n, page: p };
}

export function mapSubmission(
  d: AppData,
  pageId: string,
  submissionId: string,
  fn: (s: Submission) => Submission,
): AppData {
  const hit = findPage(d, pageId);
  if (!hit || !hit.page.submissions.some((s) => s.id === submissionId))
    return d;
  return mapPage(d, hit.notebook.id, pageId, (p) => ({
    ...p,
    submissions: p.submissions.map((s) => (s.id === submissionId ? fn(s) : s)),
  }));
}

export type BridgeNews = {
  responses: BridgeEvent[];
  tasks: BridgeEvent[];
};

/** Events that will visibly change this device's notebooks. */
export function bridgeNews(d: AppData, events: BridgeEvent[]): BridgeNews {
  return {
    responses: events.filter(
      (e) =>
        e.type === "response" &&
        !!e.pageId &&
        !!e.submissionId &&
        !!findPage(d, e.pageId)?.page.submissions.some(
          (s) => s.id === e.submissionId,
        ),
    ),
    tasks: events.filter(
      (e) =>
        e.type === "task" &&
        !!e.task &&
        d.notebooks.some(
          (n) => n.id === e.notebookId && !n.pages.some((p) => p.id === e.id),
        ),
    ),
  };
}

export function applyBridgeEvents(
  d: AppData,
  events: BridgeEvent[],
  cursor: string,
): AppData {
  if (d.bridgeCursor === cursor) return d;
  let next = d;
  for (const event of events) {
    if (event.type === "response" && event.pageId && event.submissionId)
      next = mapSubmission(next, event.pageId, event.submissionId, (s) => ({
        ...s,
        transcription: event.transcription || "",
        feedback: event.feedback || "",
        nextTask: event.nextTask || "",
      }));
    if (event.type === "task" && event.task)
      next = receiveTask(
        next,
        event.notebookId,
        event.id,
        event.task,
        event.language,
      );
  }
  return { ...next, bridgeCursor: cursor };
}

/** "Heute", "Gestern" or a short Swiss date for the last edit of a notebook. */
export function lastEdited(n: Notebook, now = Date.now()) {
  const last = Math.max(...n.pages.map((p) => p.updatedAt));
  if (!Number.isFinite(last)) return "";
  const day = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const diff = Math.round((day(now) - day(last)) / 86400000);
  if (diff <= 0) return "Heute";
  if (diff === 1) return "Gestern";
  return new Date(last).toLocaleDateString("de-CH", {
    day: "numeric",
    month: "short",
  });
}
