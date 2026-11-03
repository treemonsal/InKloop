import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
class Bucket {
  objects = new Map();
  async put(key, value, options) {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key))
      return null;
    this.objects.set(
      key,
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : new Uint8Array(value),
    );
    return { key };
  }
  async delete(key) {
    this.objects.delete(key);
  }
  async get(key) {
    const bytes = this.objects.get(key);
    return bytes
      ? {
          json: async () => JSON.parse(new TextDecoder().decode(bytes)),
          arrayBuffer: async () => bytes.slice().buffer,
        }
      : null;
  }
  async list({ prefix, startAfter = "", limit = 1000 }) {
    return {
      objects: [...this.objects.keys()]
        .filter((k) => k.startsWith(prefix) && k > startAfter)
        .sort()
        .slice(0, limit)
        .map((key) => ({ key })),
    };
  }
}
const env = { BUCKET: new Bucket() };
const request = (path, method = "GET", body, actor = "alice", extra = {}) =>
  new Request("https://inkloop.test" + path, {
    method,
    headers: {
      ...(actor ? { "oai-authenticated-user-id": actor } : {}),
      ...extra,
    },
    ...(body ? { body } : {}),
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
const rpc = async (name, args = {}, actor = "alice") =>
  (
    await worker.fetch(
      request(
        "/mcp",
        "POST",
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        actor,
      ),
      env,
    )
  ).json();
const submit = async (
  actor = "alice",
  id = "submission-1",
  pageId = "page-1",
  task = "x² = 9",
) => {
  const form = new FormData();
  form.set(
    "metadata",
    JSON.stringify({
      id,
      notebookId: "math",
      pageId,
      prompt: "Transcribe exactly.",
      task,
      subject: "Mathematik",
      language: "de",
      createdAt: Date.now(),
    }),
  );
  form.set(
    "image",
    new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], {
      type: "image/png",
    }),
    "answer.png",
  );
  return worker.fetch(
    request("/api/bridge/submission", "POST", form, actor),
    env,
  );
};
test("authenticated workspace and submission transfer without cross-user access", async () => {
  assert.equal(
    (await worker.fetch(request("/api/bridge", "GET", undefined, null), env))
      .status,
    401,
  );
  assert.equal(
    (
      await worker.fetch(
        request("/api/bridge", "GET", undefined, "alice", {
          origin: "https://evil.example",
        }),
        env,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await worker.fetch(
        request(
          "/api/bridge/workspace",
          "PUT",
          JSON.stringify({
            activeNotebook: "math",
            notebooks: [
              {
                id: "math",
                name: "Mathematik",
                subject: "Mathematik",
                language: "de",
              },
            ],
          }),
        ),
        env,
      )
    ).status,
    200,
  );
  assert.equal((await submit()).status, 200);
  const result = await rpc("inkloop_read_submission");
  assert.equal(result.result.content[1].type, "image");
  assert.equal(result.result.content[1].mimeType, "image/png");
  assert.equal(JSON.parse(result.result.content[0].text).task, "x² = 9");
  const other = await rpc(
    "inkloop_read_submission",
    { submission_id: "submission-1" },
    "bob",
  );
  assert.equal(other.result.isError, true);
});
test("MCP responses and tasks return to browser through stable cursor pagination", async () => {
  const saved = await rpc("inkloop_write_response", {
    submission_id: "submission-1",
    transcription: "x = 3",
    feedback: "Und −3?",
    next_task: "x² = 16",
  });
  assert.ok(!saved.result.isError);
  const task = await rpc("inkloop_set_task", {
    task: "Differentiate x².",
    notebook_id: "math",
    language: "en",
  });
  assert.ok(!task.result.isError);
  const status = await (await worker.fetch(request("/api/bridge"), env)).json();
  assert.equal(status.events.length, 2);
  assert.ok(
    status.events.some(
      (e) => e.type === "response" && e.transcription === "x = 3",
    ),
  );
  assert.ok(
    status.events.some((e) => e.type === "task" && e.language === "en"),
  );
  const later = await (
    await worker.fetch(
      request("/api/bridge?after=" + encodeURIComponent(status.cursor)),
      env,
    )
  ).json();
  assert.deepEqual(later.events, []);
  const other = await (
    await worker.fetch(request("/api/bridge", "GET", undefined, "bob"), env)
  ).json();
  assert.deepEqual(other.events, []);
  assert.equal(
    (
      await rpc("inkloop_write_response", {
        submission_id: "unknown",
        transcription: "x",
        feedback: "y",
      })
    ).result.isError,
    true,
  );
});
test("MCP discovery and tool list expose the four real operations", async () => {
  for (const method of ["server/discover", "initialize", "tools/list"]) {
    const response = await worker.fetch(
      request(
        "/mcp",
        "POST",
        JSON.stringify({ jsonrpc: "2.0", id: 1, method }),
        null,
      ),
      env,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(result.result);
    if (method === "tools/list") assert.equal(result.result.tools.length, 4);
  }
});

test("resending a submission keeps the original image and metadata", async () => {
  await submit("retry");
  assert.equal(
    (await submit("retry", "submission-1", "page-1", "Changed task")).status,
    200,
  );
  const result = await rpc("inkloop_read_submission", {}, "retry");
  assert.equal(JSON.parse(result.result.content[0].text).task, "x² = 9");
});

test("deleting a page removes private copies and feedback with an idempotent retry", async () => {
  await submit("delete", "older", "other-page");
  await submit("delete");
  await submit("other");
  const response = await rpc(
    "inkloop_write_response",
    {
      submission_id: "submission-1",
      transcription: "x",
      feedback: "y",
    },
    "delete",
  );
  assert.ok(!response.result.isError);
  const remove = () =>
    worker.fetch(
      request(
        "/api/bridge/page/page-1",
        "DELETE",
        JSON.stringify({
          submissionIds: ["submission-1"],
        }),
        "delete",
      ),
      env,
    );
  assert.equal((await remove()).status, 200);
  assert.equal((await remove()).status, 200);
  assert.equal(
    (
      await rpc(
        "inkloop_read_submission",
        { submission_id: "submission-1" },
        "delete",
      )
    ).result.isError,
    true,
  );
  const latest = await rpc("inkloop_read_submission", {}, "delete");
  assert.equal(JSON.parse(latest.result.content[0].text).id, "older");
  assert.ok(
    !(await rpc("inkloop_read_submission", {}, "other")).result.isError,
  );
  const events = await (
    await worker.fetch(request("/api/bridge", "GET", undefined, "delete"), env)
  ).json();
  assert.deepEqual(events.events, []);
  assert.equal((await submit("delete")).status, 409);
});

test("an empty library replaces the last published notebook index", async () => {
  const actor = "empty-library";
  const empty = { activeNotebook: "", activePage: "", notebooks: [] };
  const send = (value) =>
    worker.fetch(
      request("/api/bridge/workspace", "PUT", JSON.stringify(value), actor),
      env,
    );
  const notebook = {
    id: "math",
    name: "Mathematik",
    subject: "Mathematik",
    language: "de",
  };
  assert.equal(
    (
      await send({
        activeNotebook: "math",
        activePage: "page-1",
        notebooks: [notebook],
      })
    ).status,
    200,
  );
  assert.equal((await send(empty)).status, 200);
  const result = await rpc("inkloop_get_workspace", {}, actor);
  assert.deepEqual(JSON.parse(result.result.content[0].text).workspace, empty);
});
