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
  eraseScratch,
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

test("a quick, repeated scratch only removes the crossed ink", () => {
  const p = (x: number, y: number) => ({ x, y, p: 0.5 });
  const crossed = { ...stroke, points: [p(10, 50), p(210, 50)] };
  const adjacent = { ...stroke, id: uid(), points: [p(10, 78), p(210, 78)] };
  const original = [crossed, adjacent];
  const scratch = [p(55, 44), p(150, 47), p(58, 50), p(145, 53), p(61, 56)];
  const result = eraseScratch(original, scratch, 350);
  assert.equal(result.length, 3);
  assert.equal(result[0].points[0].x, 10);
  assert.equal(result[1].points.at(-1)?.x, 210);
  assert.equal(result[2], adjacent);
  const short = [p(85, 47), p(108, 49), p(85, 51), p(107, 53)];
  const shortResult = eraseScratch(original, short, 650);
  assert.equal(shortResult.length, 3);
  assert.equal(shortResult[2], adjacent);
  for (const realistic of [
    [p(92, 38), p(114, 57), p(93, 39), p(113, 58), p(159, 82)],
    [p(96, 37), p(97, 63), p(99, 40), p(102, 61)],
  ]) {
    const erased = eraseScratch(original, realistic, 720);
    assert.equal(erased.length, 3);
    assert.equal(erased[2], adjacent);
  }
  assert.equal(eraseScratch(original, scratch, 1700), original);
  assert.equal(eraseScratch(original, scratch.slice(0, 3), 350), original);
  assert.equal(
    eraseScratch(
      original,
      scratch.map(({ x, y }) => p(x, y - 40)),
      350,
    ),
    original,
  );
  assert.equal(
    eraseScratch(
      original,
      [p(55, 41), p(65, 55), p(62, 42), p(75, 55), p(71, 42), p(85, 55)],
      300,
    ),
    original,
  );
});

test("scratching part of a word removes the word but keeps adjacent ink", () => {
  const letter = (x: number, y: number): Stroke => ({
    ...stroke,
    id: uid(),
    points: [
      { x, y: y + 16, p: 0.5 },
      { x: x + 4, y, p: 0.5 },
      { x: x + 8, y: y + 16, p: 0.5 },
    ],
  });
  const word = [letter(50, 40), letter(61, 40), letter(72, 40), letter(83, 40)];
  const dot = { ...stroke, id: uid(), points: [{ x: 86, y: 31, p: 0.5 }] };
  const adjacent = [letter(108, 40), letter(119, 40), letter(64, 65)];
  const scratch = [
    { x: 60, y: 47, p: 0.5 },
    { x: 77, y: 50, p: 0.5 },
    { x: 60, y: 51, p: 0.5 },
    { x: 78, y: 54, p: 0.5 },
  ];
  assert.deepEqual(
    eraseScratch([...word, dot, ...adjacent], scratch, 440),
    adjacent,
  );
});
