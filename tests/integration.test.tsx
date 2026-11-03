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
const window = new Window({
  url: "https://inkloop.test",
  width: 1280,
  height: 800,
});
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
  setTransform: no,
  save: no,
  restore: no,
  beginPath: no,
  arc: no,
  quadraticCurveTo: no,
  closePath: no,
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

test("complete notebook flow: draw, undo/redo, persist and save the original submission snapshot", async () => {
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
  await click("Mathematik");
  await click("Lernbereich");
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
  const finger = (type: string, id: number, x: number, y: number) =>
    canvas.dispatchEvent(
      new window.PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: y,
        pressure: 0.5,
        bubbles: true,
      }),
    );
  const paperScroll = canvas.closest<HTMLElement>(".paper-scroll")!;
  assert.equal((canvas as HTMLCanvasElement).style.touchAction, "none");
  await act(async () => {
    finger("pointerdown", 5, 100, 180);
    finger("pointermove", 5, 100, 176);
    finger("pointerdown", 6, 160, 180);
    finger("pointermove", 5, 100, 140);
    finger("pointermove", 6, 160, 140);
    finger("pointerup", 5, 100, 140);
    finger("pointermove", 6, 160, 130);
    finger("pointerup", 6, 160, 130);
    await delay(400);
  });
  assert.ok(paperScroll.scrollTop > 0);
  assert.equal((await loadData())!.notebooks[0].pages[0].strokes.length, 0);
  await act(async () => {
    finger("pointerdown", 5, 100, 180);
    finger("pointermove", 5, 106, 184);
    finger("pointerup", 5, 112, 187);
    await delay(400);
  });
  assert.equal((await loadData())!.notebooks[0].pages[0].strokes.length, 1);
  await click("Rückgängig");
  await click("Textmarker");
  await act(async () => {
    send("pointerdown", 60, 100);
    send("pointerup", 60, 100);
    await delay(400);
  });
  assert.equal((await loadData())!.notebooks[0].pages[0].strokes.length, 0);
  await click("Stift");
  await act(async () => {
    send("pointerdown", 80, 150);
    send("pointermove", 130, 170);
    send("pointermove", 160, 150);
    send("pointerup", 190, 145);
    await delay(450);
  });
  let stored = (await loadData())!;
  assert.equal(stored.notebooks[0].pages[0].strokes.length, 1);
  assert.equal(stored.notebooks[0].pages[0].strokes[0].points.at(-1)?.x, 190);
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
  await act(async () => {
    send("pointerdown", 105, 151);
    send("pointermove", 165, 153);
    send("pointermove", 107, 156);
    send("pointermove", 164, 160);
    send("pointerup", 109, 162);
    await delay(400);
  });
  const crossed = (await loadData())!.notebooks[0].pages[0].strokes;
  assert.equal(crossed.length, 2);
  assert.deepEqual(crossed[0], stored.notebooks[0].pages[0].strokes[0]);
  await click("Rückgängig");
  await click("Antwort abgeben");
  await act(async () => {
    await delay(450);
  });
  stored = (await loadData())!;
  assert.equal(stored.notebooks[0].pages[0].submissions.length, 1);
  assert.equal(stored.notebooks[0].pages[0].submissions[0].strokes.length, 1);
  assert.ok(!document.body.textContent?.includes("KI-Antwort übernehmen"));
  await click("Seiten");
  await click("Neue Seite");
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
  await click("Deine Handschrift");
  await click("Schliessen");
  assert.equal((await loadData())!.samples[0].id, "old-reference");
  await click("Deine Handschrift");
  for (let step = 0; step < 4; step++) {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'dialog [data-testid="ink-canvas"]',
    )!;
    assert.equal(canvas.style.touchAction, "none");
    assert.equal(
      canvas.parentElement
        ?.querySelector("svg.paper-ink")
        ?.getAttribute("viewBox"),
      "0 0 900 1200",
    );
    const selection = new window.Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
    canvas.dispatchEvent(selection);
    assert.equal(selection.defaultPrevented, true);
    const stylus = new window.Event("touchstart", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(stylus, "changedTouches", {
      value: [{ identifier: 31, target: canvas, touchType: "stylus" }],
    });
    canvas.dispatchEvent(stylus);
    assert.equal(stylus.defaultPrevented, true);
    await act(async () => {
      for (const [type, x, pointerType] of [
        ["pointerdown", 80, "touch"],
        ["pointerdown", 60, "pen"],
        ["pointermove", 90, "touch"],
        ["pointermove", 60.2, "pen"],
        ["pointerup", 60.3, "pen"],
        ["pointerup", 91, "touch"],
      ] as const)
        canvas.dispatchEvent(
          new window.PointerEvent(type, {
            pointerId: pointerType === "pen" ? 3 : 4,
            pointerType,
            button: 0,
            clientX: x,
            clientY: 70 + step * 2,
            pressure: 0.5,
            bubbles: true,
          }),
        );
    });
    assert.ok(canvas.parentElement?.querySelector("canvas.paper-ink"));
    await click(step === 3 ? "Schriftprofil speichern" : "Nächste Probe");
  }
  await act(async () => {
    await delay(450);
  });
  const saved = (await loadData())!;
  assert.equal(saved.samples.length, 4);
  assert.ok(
    saved.samples.every(
      (s) => s.strokes.length === 1 && s.strokes[0].points.length >= 2,
    ),
  );
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
    await click("Mathematik");
    assert.ok(!document.body.textContent?.includes("Berücksichtige auch −3."));
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
    await click("Finanz- & Rechnungswesen");
    await click("Antwort abgeben");
    await act(async () => {
      await delay(400);
    });
    const local = (await loadData())!.notebooks[1].pages[0].submissions[0];
    assert.equal(uploadedId, undefined);
    await click("Schliessen");
    online = true;
    await click("Lernbereich");
    await click("Erneut an ChatGPT senden");
    await act(async () => {
      await delay(400);
    });
    const submissions = (await loadData())!.notebooks[1].pages[0].submissions;
    assert.equal(uploadedId, local.id);
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].handoff?.sent, true);
    assert.equal(submissions[0].handoff?.subject, "FRW");
    assert.ok(!document.querySelector("dialog"));
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

test("the library opens first and each notebook remembers its last page", async () => {
  const d = initialData();
  await saveData(d);
  const host = document.body.appendChild(document.createElement("div"));
  const app = createRoot(host);
  try {
    await act(async () => {
      app.render(<App />);
      await delay(60);
    });
    await act(async () => {
      await delay(80);
    });
    assert.equal(document.querySelector("main h1")?.textContent, "Lernhefte");
    assert.equal(document.querySelector('[data-testid="ink-canvas"]'), null);
    assert.equal(document.documentElement.dataset.theme, "dark");
    await click("Einstellungen");
    const appearance = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Darstellung"]',
    )!;
    const changeTheme = async (value: string) => {
      await act(async () => {
        appearance.value = value;
        appearance.dispatchEvent(new window.Event("change", { bubbles: true }));
        await delay(400);
      });
      assert.equal(document.documentElement.dataset.theme, value);
      assert.equal((await loadData())!.settings.theme, value);
    };
    await changeTheme("light");
    await changeTheme("dark");
    await click("Schliessen");
    await click("Mathematik");
    await click("Seiten");
    await click("Neue Seite");
    const swipe = async (dx: number, withPalm = false) => {
      const canvas = document.querySelector('[data-testid="ink-canvas"]')!;
      const send = (
        type: string,
        id: number,
        x: number,
        pointerType = "touch",
      ) =>
        canvas.dispatchEvent(
          new window.PointerEvent(type, {
            pointerId: id,
            pointerType,
            button: 0,
            clientX: x,
            clientY: 160,
            bubbles: true,
          }),
        );
      await act(async () => {
        if (withPalm) {
          send("pointerdown", 7, 480);
          send("pointerdown", 8, 450, "pen");
          send("pointerup", 8, 450, "pen");
        }
        send("pointerdown", 5, 200);
        send("pointerdown", 6, 250);
        send("pointermove", 5, 200 + dx);
        send("pointermove", 6, 250 + dx);
        send("pointerup", 5, 200 + dx);
        send("pointerup", 6, 250 + dx);
        if (withPalm) send("pointerup", 7, 480);
        await delay(400);
      });
    };
    await swipe(-90);
    assert.ok(document.body.textContent?.includes("Letzte Seite"));
    await swipe(90, true);
    const afterSwipe = (await loadData())!;
    assert.equal(afterSwipe.activePage, afterSwipe.notebooks[0].pages[0].id);
    assert.equal(afterSwipe.notebooks[0].pages[0].strokes.length, 0);
    const surface = document.querySelector(".paper-scroll")!;
    const makeTouch = (
      identifier: number,
      clientX: number,
      clientY: number,
      touchType = "direct",
    ) => ({ identifier, clientX, clientY, touchType, target: surface });
    const sendTouches = (
      type: string,
      changedTouches: ReturnType<typeof makeTouch>[],
    ) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "changedTouches", { value: changedTouches });
      surface.dispatchEvent(event);
    };
    await act(async () => {
      sendTouches("touchstart", [
        makeTouch(5, 200, 160),
        makeTouch(6, 250, 160),
        makeTouch(7, 410, 175),
      ]);
      sendTouches("touchmove", [
        makeTouch(5, 201, 166),
        makeTouch(6, 250, 166),
      ]);
      sendTouches("touchmove", [
        makeTouch(5, 130, 170),
        makeTouch(6, 180, 168),
      ]);
      sendTouches("touchend", [makeTouch(5, 129, 170), makeTouch(6, 179, 168)]);
      await delay(400);
    });
    await click("Seitenoptionen");
    assert.equal(
      document.querySelector<HTMLInputElement>(".page-title")?.value,
      "Seite 2",
    );
    await click("Schliessen");
    await click("Alle Lernhefte");
    await click("Finanz- & Rechnungswesen");
    await click("Alle Lernhefte");
    await click("Mathematik");
    await click("Seitenoptionen");
    assert.equal(
      document.querySelector<HTMLInputElement>(".page-title")?.value,
      "Seite 2",
    );
    assert.ok(
      document.querySelector('.topbar [aria-label="Schreibwerkzeuge"]'),
    );
    assert.equal(document.querySelector(".writing-bottom"), null);
    const language = document.querySelector<HTMLSelectElement>(
      'select[aria-label="Seitensprache"]',
    )!;
    assert.equal(language.value, "de");
    await act(async () => {
      language.value = "en";
      language.dispatchEvent(new window.Event("change", { bubbles: true }));
      await delay(400);
    });
    const updated = (await loadData())!.notebooks[0];
    assert.equal(updated.pages[1].language, "en");
    assert.equal(updated.pages[0].language ?? updated.language, "de");
    await click("Schliessen");
    await click("Alle Lernhefte");
    for (const name of [
      "Mathematik",
      "Finanz- & Rechnungswesen",
      "Wirtschaft & Recht",
    ]) {
      await click("Optionen für " + name);
      await click("Abbrechen");
      assert.ok(document.querySelector(`[aria-label="${name}"]`));
      await click("Optionen für " + name);
      await click("Lernheft löschen");
    }
    await act(async () => {
      await delay(400);
    });
    assert.deepEqual((await loadData())!.notebooks, []);
    assert.ok(document.body.textContent?.includes("Keine Lernhefte"));
  } finally {
    await act(async () => {
      app.unmount();
    });
    host.remove();
    await window.happyDOM.abort();
  }
});
