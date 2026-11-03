import assert from "node:assert/strict";
import { registerHooks } from "node:module";
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".css"))
      return {
        format: "module",
        source: "export default {};",
        shortCircuit: true,
      };
    return next(url, context);
  },
});
import test from "node:test";
import { Window } from "happy-dom";
import "fake-indexeddb/auto";
const window = new Window({ url: "https://inkloop.test" });
window.document.write("<!doctype html><html><head></head><body></body></html>");
Object.defineProperty(window.document, "compatMode", {
  value: "CSS1Compat",
  configurable: true,
});
for (const name of [
  "window",
  "document",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLCanvasElement",
  "HTMLDialogElement",
  "HTMLButtonElement",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "File",
  "Blob",
  "navigator",
  "location",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = (window as unknown as Record<string, unknown>)[name];
  Object.defineProperty(globalThis, name, {
    value:
      typeof value === "function" &&
      ["requestAnimationFrame", "cancelAnimationFrame"].includes(name)
        ? value.bind(window)
        : value,
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});
Object.defineProperty(globalThis, "BroadcastChannel", {
  value: undefined,
  configurable: true,
});
const no = () => {};
const ctx = {
  clearRect: no,
  save: no,
  restore: no,
  beginPath: no,
  arc: no,
  fill: no,
  stroke: no,
  moveTo: no,
  lineTo: no,
  translate: no,
  scale: no,
  fillRect: no,
  fillText: no,
  measureText: (s: string) => ({ width: s.length * 8 }),
};
window.HTMLCanvasElement.prototype.getContext = function () {
  return ctx;
} as never;
window.HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
  callback(new Blob(["PNG"], { type: "image/png" }));
};
window.HTMLCanvasElement.prototype.getBoundingClientRect = function () {
  return {
    left: 0,
    top: 0,
    width: 900,
    height: 1200,
    right: 900,
    bottom: 1200,
    x: 0,
    y: 0,
    toJSON: no,
  };
};
window.HTMLCanvasElement.prototype.setPointerCapture = no;
window.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
Object.defineProperty(URL, "createObjectURL", {
  value: () => "blob:inkloop-test",
  configurable: true,
});
Object.defineProperty(URL, "revokeObjectURL", {
  value: no,
  configurable: true,
});
const React = await import("react");
const { act } = React;
Object.defineProperty(globalThis, "React", {
  value: React,
  configurable: true,
});
const { createRoot } = await import("react-dom/client");
const { default: App } = await import("../src/App");
const { initialData } = await import("../src/model");
const { saveData, loadData } = await import("../src/storage");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const click = async (text: string) => {
  const b = [...document.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === text || b.getAttribute("aria-label") === text,
  );
  assert.ok(b, `button ${text}`);
  await act(async () => {
    b.click();
    await delay(20);
  });
};
const setInput = async (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  const prototype =
    input.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
};
const root = createRoot(
  document.body.appendChild(document.createElement("div")),
);

test("complete notebook flow: draw, undo/redo, persist, submit snapshot, import answer and preserve original snapshots", async () => {
  const d = initialData();
  d.onboardingDone = true;
  await saveData(d);
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await delay(80);
  });
  assert.ok(
    document.body.textContent?.includes("Mathematik"),
    document.body.textContent || "empty",
  );
  await click("Aufgabe einfügen");
  const task = document.querySelector("dialog textarea") as HTMLTextAreaElement;
  await setInput(task, "Solve x² = 9.");
  await click("Aufgabe speichern");
  assert.ok(document.body.textContent?.includes("Solve x² = 9."));
  const canvas = document.querySelector('[data-testid="ink-canvas"]')!;
  const send = (type: string, x: number, y: number, pointerType = "pen") =>
    canvas.dispatchEvent(
      new window.PointerEvent(type, {
        pointerId: 1,
        pointerType,
        button: 0,
        clientX: x,
        clientY: y,
        pressure: 0.6,
        bubbles: true,
      }),
    );
  await act(async () => {
    send("pointerdown", 80, 150);
    send("pointermove", 130, 170);
    send("pointermove", 160, 150);
    send("pointerup", 160, 150);
    await delay(450);
  });
  let stored = (await loadData())!;
  assert.equal(stored.notebooks[0].pages[0].strokes.length, 1);
  assert.equal(stored.notebooks[0].pages[0].task, "Solve x² = 9.");
  await click("Rückgängig");
  await act(async () => {
    await delay(400);
  });
  assert.equal((await loadData())!.notebooks[0].pages[0].strokes.length, 0);
  await click("Wiederholen");
  await act(async () => {
    await delay(400);
  });
  assert.equal((await loadData())!.notebooks[0].pages[0].strokes.length, 1);
  await click("Antwort abgeben");
  await act(async () => {
    await delay(400);
  });
  assert.ok(document.body.textContent?.includes("Deine Lösung geht weiter."));
  stored = (await loadData())!;
  assert.equal(stored.notebooks[0].pages[0].submissions.length, 1);
  assert.equal(stored.notebooks[0].pages[0].submissions[0].strokes.length, 1);
  await click("KI-Antwort übernehmen");
  await setInput(
    document.querySelector("dialog textarea") as HTMLTextAreaElement,
    JSON.stringify({
      transcription: "x = 3",
      feedback: "Also consider −3.",
      next_task: "Solve x² = 16.",
    }),
  );
  await click("Im Lernheft speichern");
  await act(async () => {
    await delay(450);
  });
  stored = (await loadData())!;
  assert.equal(
    stored.notebooks[0].pages[0].submissions[0].transcription,
    "x = 3",
  );
  assert.equal(
    stored.notebooks[0].pages[0].submissions[0].feedback,
    "Also consider −3.",
  );
  await click("Feedback");
  await click("Auf neuer Seite lösen");
  await act(async () => {
    await delay(450);
  });
  stored = (await loadData())!;
  assert.equal(stored.notebooks[0].pages.length, 2);
  assert.equal(stored.notebooks[0].pages[1].task, "Solve x² = 16.");
  assert.equal(stored.notebooks[0].pages[1].strokes.length, 0);
  assert.equal(stored.notebooks[0].pages[0].submissions[0].strokes.length, 1);
  // Finger contact cannot create ink in Pencil-only mode.
  const fresh = document.querySelector('[data-testid="ink-canvas"]')!;
  await act(async () => {
    fresh.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: 40,
        clientY: 50,
        bubbles: true,
      }),
    );
    fresh.dispatchEvent(
      new window.PointerEvent("pointerup", {
        pointerId: 2,
        pointerType: "touch",
        button: 0,
        clientX: 40,
        clientY: 50,
        bubbles: true,
      }),
    );
    await delay(400);
  });
  assert.equal((await loadData())!.notebooks[0].pages[1].strokes.length, 0);
  await act(async () => {
    root.unmount();
  });
  await window.happyDOM.abort();
});

test("four handwriting references replace the profile only after completion and survive reopening", async () => {
  const d = initialData();
  d.onboardingDone = true;
  d.samples = [
    {
      id: "old-reference",
      label: "previous",
      strokes: [
        {
          id: "old-stroke",
          tool: "pen",
          color: "#eee9df",
          width: 2.5,
          points: [{ x: 1, y: 1, p: 0.5 }],
        },
      ],
    },
  ];
  await saveData(d);
  const host = document.body.appendChild(document.createElement("div"));
  const nextRoot = createRoot(host);
  await act(async () => {
    nextRoot.render(<App />);
  });
  await act(async () => {
    await delay(80);
  });
  await click("Deine Handschrift1 Referenzen hinterlegt");
  await click("Schließen");
  assert.equal((await loadData())!.samples[0].id, "old-reference");
  await click("Deine Handschrift1 Referenzen hinterlegt");
  for (let step = 0; step < 4; step++) {
    const canvas = document.querySelector('dialog [data-testid="ink-canvas"]')!;
    assert.ok(canvas);
    await act(async () => {
      for (const [type, x] of [
        ["pointerdown", 60],
        ["pointermove", 110],
        ["pointerup", 120],
      ] as const)
        canvas.dispatchEvent(
          new window.PointerEvent(type, {
            pointerId: 3,
            pointerType: "pen",
            button: 0,
            clientX: x,
            clientY: 70 + step * 2,
            pressure: 0.5,
            bubbles: true,
          }),
        );
    });
    await click(step === 3 ? "Schriftprofil speichern" : "Nächste Probe");
  }
  await act(async () => {
    await delay(450);
  });
  const saved = (await loadData())!;
  assert.equal(saved.samples.length, 4);
  assert.ok(saved.samples.every((s) => s.strokes.length === 1));
  assert.notEqual(saved.samples[0].id, "old-reference");
  assert.equal(saved.notebooks[0].pages[0].strokes.length, 0);
  await act(async () => {
    nextRoot.unmount();
  });
  host.remove();
  await window.happyDOM.abort();
});

test("plugin responses arrive automatically and new tasks preserve an existing handwritten page", async () => {
  const d = initialData();
  d.onboardingDone = true;
  const book = d.notebooks[0],
    page = book.pages[0];
  page.strokes = [
    {
      id: "ink-1",
      tool: "pen",
      color: "#eee9df",
      width: 2.5,
      points: [{ x: 100, y: 100, p: 0.5 }],
    },
  ];
  page.submissions = [
    {
      id: "shared-1",
      createdAt: Date.now(),
      strokes: structuredClone(page.strokes),
      task: "Task",
      transcription: "",
      feedback: "",
      nextTask: "",
    },
  ];
  await saveData(d);
  const originalFetch = globalThis.fetch;
  let phase = 0;
  globalThis.fetch = (async (input) => {
    const path = String(input);
    if (!path.startsWith("/api/bridge"))
      throw new Error("Unexpected network request");
    if (path.includes("workspace"))
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    const responseEvent = {
      id: "event-one",
      createdAt: Date.now(),
      type: "response",
      notebookId: book.id,
      pageId: page.id,
      submissionId: "shared-1",
      transcription: "x = 3",
      feedback: "Berücksichtige auch −3.",
      nextTask: "",
    };
    const taskEvent = {
      id: "event-two",
      createdAt: Date.now(),
      type: "task",
      notebookId: book.id,
      task: "Solve x² = 16.",
      language: "en",
    };
    const events =
      phase === 0 ? [responseEvent] : phase === 1 ? [taskEvent] : [];
    const cursor = phase === 0 ? "cursor-one" : "cursor-two";
    phase++;
    return new Response(JSON.stringify({ ok: true, events, cursor }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const host = document.body.appendChild(document.createElement("div"));
  const app = createRoot(host);
  try {
    await act(async () => {
      app.render(<App />);
    });
    await act(async () => {
      await delay(100);
    });
    await act(async () => {
      await delay(500);
    });
    let saved = (await loadData())!;
    assert.equal(
      saved.notebooks[0].pages[0].submissions[0].transcription,
      "x = 3",
    );
    assert.equal(saved.bridgeCursor, "cursor-one");
    assert.ok(document.body.textContent?.includes("Berücksichtige auch −3."));
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
      await delay(100);
    });
    await act(async () => {
      await delay(450);
    });
    saved = (await loadData())!;
    assert.equal(saved.notebooks[0].pages.length, 2);
    assert.equal(saved.notebooks[0].pages[1].task, "Solve x² = 16.");
    assert.equal(saved.activePage, page.id);
    assert.equal(saved.notebooks[0].pages[0].strokes.length, 1);
    assert.equal(saved.notebooks[0].language, "en");
    assert.equal(saved.bridgeCursor, "cursor-two");
  } finally {
    await act(async () => {
      app.unmount();
    });
    host.remove();
    globalThis.fetch = originalFetch;
    await window.happyDOM.abort();
  }
});

test("an offline submission can be sent later without creating a duplicate", async () => {
  const d = initialData();
  d.onboardingDone = true;
  const book = d.notebooks[1];
  const page = book.pages[0];
  d.activeNotebook = book.id;
  d.activePage = page.id;
  page.task = "Büromaterial für CHF 120 auf Rechnung kaufen.";
  page.strokes = [
    {
      id: "ink-retry",
      tool: "pen",
      color: "#eee9df",
      width: 2.5,
      points: [{ x: 5, y: 5, p: 0.5 }],
    },
  ];
  await saveData(d);
  const originalFetch = globalThis.fetch;
  const originalFormData = globalThis.FormData;
  globalThis.FormData = window.FormData as unknown as typeof FormData;
  let uploadedId: string | undefined;
  let online = false;
  let returnFeedback = false;
  globalThis.fetch = (async (input, init) => {
    if (!online) throw new Error("offline");
    const path = String(input);
    if (path.endsWith("/submission")) {
      uploadedId = JSON.parse(
        String((init?.body as FormData).get("metadata")),
      ).id;
    }
    const events =
      returnFeedback && path.endsWith("after=")
        ? [
            {
              type: "response",
              id: "feedback-event",
              createdAt: 1,
              notebookId: book.id,
              pageId: page.id,
              submissionId: uploadedId,
              transcription:
                "| Soll | Haben | Betrag |\n| --- | --- | --- |\n| Büromaterial | Kreditoren | 120 |",
              feedback: "Soll und Haben stimmen.",
            },
          ]
        : [];
    return Response.json({
      ok: true,
      events,
      cursor: events.length ? "feedback-cursor" : "",
    });
  }) as typeof fetch;
  const host = document.body.appendChild(document.createElement("div"));
  const app = createRoot(host);
  try {
    await act(async () => {
      app.render(<App />);
    });
    await act(async () => {
      await delay(80);
    });
    await click("Antwort abgeben");
    await act(async () => {
      await delay(400);
    });
    const local = (await loadData())!.notebooks[1].pages[0].submissions[0];
    assert.equal(uploadedId, undefined);
    await click("Schließen");
    online = true;
    await click("Erneut an ChatGPT senden");
    await act(async () => {
      await delay(400);
    });
    const submissions = (await loadData())!.notebooks[1].pages[0].submissions;
    assert.equal(uploadedId, local.id);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].handoff?.sent, true);
    assert.equal(submissions[0].handoff?.subject, "FRW");
    await click("Schließen");
    returnFeedback = true;
    await act(async () => {
      window.dispatchEvent(new window.Event("focus"));
      await delay(30);
    });
    await act(async () => {
      await delay(450);
    });
    const updated = (await loadData())!.notebooks[1].pages[0].submissions;
    assert.equal(updated.length, 1);
    assert.equal(updated[0].id, local.id);
    assert.equal(updated[0].feedback, "Soll und Haben stimmen.");
    assert.match(updated[0].transcription, /Kreditoren/);
  } finally {
    await act(async () => {
      app.unmount();
    });
    host.remove();
    globalThis.fetch = originalFetch;
    globalThis.FormData = originalFormData;
    await window.happyDOM.abort();
  }
});
