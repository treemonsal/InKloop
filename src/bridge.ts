import type { AppData, Notebook, Submission } from "./model";
export type BridgeEvent = {
  id: string;
  createdAt: number;
  type: "task" | "response";
  notebookId: string;
  pageId?: string;
  submissionId?: string;
  task?: string;
  language?: "de" | "en";
  transcription?: string;
  feedback?: string;
  nextTask?: string;
};
export const hostedWorkspace =
  !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) &&
  !window.location.hostname.endsWith(".test");
const SESSION_WORKSPACE = "inkloop-verified-workspace";
let workspaceHeader = "";
export class WorkspaceChanged extends Error {}

export async function browserWorkspace(
  allowOffline = false,
): Promise<string | null> {
  if (!hostedWorkspace) return "workspace";
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (response.status === 401) {
      try {
        sessionStorage.removeItem(SESSION_WORKSPACE);
      } catch {}
      return null;
    }
    if (!response.ok) throw new Error("Inkloop konnte das Konto nicht prüfen.");
    const { workspace } = await response.json();
    if (
      typeof workspace !== "string" ||
      !/^(workspace|account-[0-9a-f]{64})$/.test(workspace)
    )
      throw new Error("Inkloop konnte das Konto nicht prüfen.");
    try {
      sessionStorage.setItem(SESSION_WORKSPACE, workspace);
    } catch {}
    return workspace;
  } catch (error) {
    if (allowOffline && !navigator.onLine) {
      try {
        return sessionStorage.getItem(SESSION_WORKSPACE);
      } catch {}
    }
    throw error;
  }
}
export function useBridgeWorkspace(workspace: string) {
  workspaceHeader = hostedWorkspace ? workspace : "";
}
const request = async (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (workspaceHeader) headers.set("x-inkloop-workspace", workspaceHeader);
  const response = await fetch(path, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10000),
    credentials: "same-origin",
  });
  if (workspaceHeader && (response.status === 401 || response.status === 409))
    throw new WorkspaceChanged();
  if (!response.ok)
    throw new Error("Plugin-Verbindung momentan nicht verfügbar.");
  return response.json();
};
export async function bridgeStatus(
  after = "",
): Promise<{ ok: boolean; events: BridgeEvent[]; cursor: string }> {
  return request("/api/bridge?after=" + encodeURIComponent(after));
}
export async function publishWorkspace(data: AppData) {
  return request("/api/bridge/workspace", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activeNotebook: data.activeNotebook,
      activePage: data.activePage,
      notebooks: data.notebooks.map((n) => ({
        id: n.id,
        name: n.name,
        subject: n.subject,
        language: n.language,
        pages: n.pages.map((p) => ({ id: p.id, title: p.title })),
      })),
    }),
  });
}
export async function publishSubmission(
  n: Notebook,
  pageId: string,
  s: Submission,
  blob: Blob,
  prompt: string,
) {
  const body = new FormData();
  body.set(
    "metadata",
    JSON.stringify({
      id: s.id,
      createdAt: s.createdAt,
      notebookId: n.id,
      pageId,
      subject: n.subject,
      language: n.language,
      task: s.task,
      prompt,
    }),
  );
  body.set("image", blob, "answer.png");
  return request("/api/bridge/submission", { method: "POST", body });
}

export async function deleteSharedPage(
  pageId: string,
  submissionIds: string[],
) {
  return request("/api/bridge/page/" + encodeURIComponent(pageId), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ submissionIds }),
  });
}
