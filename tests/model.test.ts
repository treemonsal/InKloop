import test from "node:test";
import assert from "node:assert/strict";
import {
  initialData,
  parseBackup,
  receiveTask,
  parseResponse,
  chatLink,
  eraseAt,
  eraseAlong,
  strokePath,
  buildPrompt,
  uid,
  type Stroke,
  type Submission,
} from "../src/model.ts";
const stroke: Stroke = {
  id: uid(),
  tool: "pen",
  color: "#eee9df",
  width: 2.5,
  points: [
    { x: 10, y: 10, p: 0.5 },
    { x: 100, y: 100, p: 0.8 },
  ],
};
test("backup roundtrip preserves handwriting, references, tasks and past submissions", () => {
  const d = initialData(),
    p = d.notebooks[0].pages[0];
  p.strokes = [stroke];
  p.task = "Berechne $x^2$";
  p.submissions = [
    {
      id: uid(),
      createdAt: Date.now(),
      strokes: [stroke],
      task: p.task,
      transcription: "−4.75",
      feedback: "Prüfe das Vorzeichen.",
      nextTask: "",
    },
  ];
  d.samples = [{ id: uid(), label: "1 l I", ["strokes"]: [stroke] }];
  assert.deepEqual(parseBackup(JSON.stringify(d)), d);
});
test("rejects partial, oversized, nonfinite, duplicate and invalid-reference backups", () => {
  assert.throws(() => parseBackup("{"), /gültige/);
  assert.throws(() => parseBackup(JSON.stringify({ version: 2 })), /Format/);
  let d = initialData();
  d.notebooks[0].pages[0].strokes = [
    { ...stroke, points: [{ x: NaN, y: 0, p: 0.5 }] },
  ];
  assert.throws(() => parseBackup(JSON.stringify(d)), /ungültige/);
  d = initialData();
  d.notebooks[1].id = d.notebooks[0].id;
  assert.throws(() => parseBackup(JSON.stringify(d)), /ungültige/);
  d = initialData();
  d.activePage = "absent";
  assert.throws(() => parseBackup(JSON.stringify(d)), /aktive/);
});
test("only approved HTTPS original chat links open", () => {
  assert.equal(
    chatLink("https://chatgpt.com/c/123", "chatgpt"),
    "https://chatgpt.com/c/123",
  );
  assert.equal(
    chatLink("https://claude.ai/chat/abc", "claude"),
    "https://claude.ai/chat/abc",
  );
  assert.equal(chatLink("", "claude"), "https://claude.ai/");
  for (const link of [
    "javascript:alert(1)",
    "https://chatgpt.com.evil.test/c/1",
    "http://claude.ai/chat/a",
    "https://user:password@chatgpt.com/",
  ])
    assert.throws(() => chatLink(link, "chatgpt"));
});
test("eraser keeps both ends of a stroke and catches fast movement between samples", () => {
  const d = eraseAt([stroke], { x: 55, y: 55, p: 0.5 }, 10);
  assert.equal(d.length, 2);
  assert.deepEqual(d[0].points[0], stroke.points[0]);
  assert.deepEqual(d[1].points.at(-1), stroke.points[1]);
  assert.ok(d[0].points.at(-1)!.x < 55 && d[1].points[0].x > 55);
  assert.deepEqual(eraseAt([stroke], { x: 100, y: 10, p: 0.5 }, 10), [stroke]);
  assert.equal(
    eraseAlong([stroke], { x: 55, y: 0, p: 0.5 }, { x: 55, y: 110, p: 0.5 }, 10)
      .length,
    2,
  );
});
test("a freehand corner is rounded without shifting the ends", () => {
  const points = [
    { x: 0, y: 0, p: 0.3 },
    { x: 20, y: 0, p: 0.7 },
    { x: 20, y: 20, p: 0.9 },
  ];
  const path = strokePath({ ...stroke, points });
  assert.deepEqual(path[0], points[0]);
  assert.deepEqual(path.at(-1), points.at(-1));
  assert.ok(path.some((p) => p.x > 10 && p.x < 20 && p.y > 0 && p.y < 10));
  assert.deepEqual(strokePath({ ...stroke, tool: "line", points }), [
    points[0],
    points.at(-1),
  ]);
});
test("response import separates exact transcription from feedback and supports raw replies", () => {
  assert.deepEqual(
    parseResponse(
      '```json\n{"transcription":"x² = −4","feedback":"Check it","next_task":"Next"}\n```',
    ),
    { transcription: "x² = −4", feedback: "Check it", nextTask: "Next" },
  );
  assert.deepEqual(parseResponse("<script>alert(1)</script>"), {
    transcription: "",
    feedback: "<script>alert(1)</script>",
    nextTask: "",
  });
  assert.equal(
    parseResponse('{"transcription":"a","feedback":"b"}').transcription,
    "a",
  );
});
test("handoff prompt preserves errors, context, subject, language and sample boundaries", () => {
  const d = initialData(),
    n = d.notebooks[1];
  n.language = "en";
  const s: Submission = {
    id: "test-submission",
    createdAt: 0,
    strokes: [stroke],
    task: "Soll/Haben?",
    transcription: "",
    feedback: "",
    nextTask: "",
  };
  const prompt = buildPrompt(n, s, 4);
  for (const expected of [
    "English",
    "FRW",
    "Soll/Haben?",
    "KEINE",
    "4 beschriftete",
    "NICHT",
    "[unklar:",
    "test-submission",
  ])
    assert.ok(prompt.includes(expected), expected);
});

test("large backups and legacy long transcriptions can be restored", () => {
  const d = initialData();
  const page = d.notebooks[0].pages[0];
  const transcription = "x".repeat(200001);
  page.submissions = Array.from({ length: 201 }, () => ({
    id: uid(),
    createdAt: 1,
    strokes: [],
    task: "",
    transcription,
    feedback: "",
    nextTask: "",
  }));
  const exported = JSON.stringify(d);
  assert.ok(exported.length > 40_000_000);
  assert.equal(
    parseBackup(exported).notebooks[0].pages[0].submissions[0].transcription,
    transcription,
  );
});

test("two received tasks preserve a written assignment and the open page", () => {
  const d = initialData();
  const n = d.notebooks[0];
  n.pages[0].task = "Vorhandene Aufgabe";
  const first = receiveTask(d, n.id, "event-one", "Erste Aufgabe");
  const second = receiveTask(first, n.id, "event-two", "Zweite Aufgabe", "en");
  assert.equal(second.activePage, d.activePage);
  assert.deepEqual(
    second.notebooks[0].pages.map((p) => p.task),
    ["Vorhandene Aufgabe", "Erste Aufgabe", "Zweite Aufgabe"],
  );
  assert.equal(
    receiveTask(second, n.id, "event-two", "Zweite Aufgabe"),
    second,
  );
});
