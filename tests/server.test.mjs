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

test("public entry keeps owner storage and ChatGPT bridge scoped to the signed-in account", async () => {
  const hosted = {
    BUCKET: new Bucket(),
    INKLOOP_LEGACY_OWNER_EMAIL: "owner@example.test",
  };
  const visitor = { "oai-authenticated-user-email": "visitor@example.test" };
  const owner = { "oai-authenticated-user-email": "owner@example.test" };
  assert.equal(
    (
      await worker.fetch(
        request("/api/session", "GET", undefined, null),
        hosted,
      )
    ).status,
    401,
  );
  const scope = async (id, headers) =>
    (
      await (
        await worker.fetch(
          request("/api/session", "GET", undefined, id, headers),
          hosted,
        )
      ).json()
    ).workspace;
  assert.equal(await scope("site-owner", owner), "workspace");
  const visitorScope = await scope("site-visitor", visitor);
  assert.match(visitorScope, /^account-[a-f0-9]{64}$/);
  assert.notEqual(visitorScope, await scope("another-visitor", visitor));
  const bridge = (scope) =>
    worker.fetch(
      request("/api/bridge", "GET", undefined, "site-visitor", {
        ...visitor,
        "x-inkloop-workspace": scope,
      }),
      hosted,
    );
  assert.equal((await bridge("workspace")).status, 409);
  assert.equal((await bridge(visitorScope)).status, 200);
});

test("MCP events verify a callback and deliver a submission once for the matching account", async () => {
  const hosted = {
    BUCKET: new Bucket(),
    INKLOOP_LEGACY_OWNER_EMAIL: "owner@example.test",
    INKLOOP_WORK_INCLUDED_ONLY: "1",
  };
  const owner = {
    "oai-authenticated-user-email": "owner@example.test",
    "x-inkloop-workspace": "workspace",
  };
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const secret = "whsec_" + Buffer.alloc(32, 7).toString("base64");
  const url = "https://chatgpt.com/backend-api/test-inkloop";
  globalThis.fetch = async (target, init) => {
    assert.equal(target, url);
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    const { createHmac } = await import("node:crypto");
    const signature = createHmac("sha256", Buffer.alloc(32, 7))
      .update(
        [
          init.headers["webhook-id"],
          init.headers["webhook-timestamp"],
          init.body,
        ].join("."),
      )
      .digest("base64");
    assert.equal(init.headers["webhook-signature"], "v1," + signature);
    if (body.type === "verification")
      return Response.json({ challenge: body.challenge });
    deliveries.push(body);
    return Response.json({ ok: true });
  };
  const call = async (method, params = {}, actor = "owner") =>
    (
      await worker.fetch(
        request(
          "/mcp",
          "POST",
          JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          actor,
          actor === "owner"
            ? owner
            : { "oai-authenticated-user-email": "visitor@example.test" },
        ),
        hosted,
      )
    ).json();
  const event = {
    name: "inkloop.submission.created",
    arguments: {},
    delivery: { mode: "webhook", url, secret },
  };
  const upload = async () => {
    const body = new FormData();
    body.set(
      "metadata",
      JSON.stringify({
        id: "ink-one",
        createdAt: Date.now(),
        notebookId: "math",
        pageId: "one",
        subject: "Mathematik",
        language: "de",
        task: "Private task",
        prompt: "Private prompt",
      }),
    );
    body.set(
      "image",
      new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }),
      "answer.png",
    );
    return (
      await worker.fetch(
        request("/api/bridge/submission", "POST", body, "owner", owner),
        hosted,
      )
    ).json();
  };
  try {
    assert.ok((await call("server/discover")).result.capabilities.events);
    assert.equal((await call("events/list")).result.events[0].name, event.name);
    assert.ok((await call("events/subscribe", event, "visitor")).error);
    assert.ok(
      (
        await call("events/subscribe", {
          ...event,
          delivery: { ...event.delivery, url: "https://evil.test/hook" },
        })
      ).error,
    );
    assert.ok((await call("events/subscribe", event)).result.id);
    hosted.INKLOOP_WORK_INCLUDED_ONLY = "0";
    assert.equal((await upload()).automatic, false);
    assert.equal(deliveries.length, 0);
    hosted.INKLOOP_WORK_INCLUDED_ONLY = "1";
    assert.equal((await upload()).automatic, true);
    assert.equal((await upload()).automatic, true);
    assert.equal(deliveries.length, 1);
    assert.deepEqual(deliveries[0].data, { submission_id: "ink-one" });
    await call("events/unsubscribe", event);
    assert.equal((await upload()).automatic, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the private relay reviews only owner submissions and returns one feedback event", async () => {
  const hosted = {
    BUCKET: new Bucket(),
    INKLOOP_LEGACY_OWNER_EMAIL: "owner@example.test",
    INKLOOP_REVIEW_KEY: "relay-test-secret",
  };
  const owner = {
    "oai-authenticated-user-email": "owner@example.test",
    "x-inkloop-workspace": "workspace",
  };
  const relay = (method, args, key = hosted.INKLOOP_REVIEW_KEY) =>
    worker.fetch(
      request("/api/review/relay", method, args && JSON.stringify(args), null, {
        "x-inkloop-review-key": key,
      }),
      hosted,
    );
  const upload = async (id, actor, headers) => {
    const body = new FormData();
    body.set(
      "metadata",
      JSON.stringify({
        id,
        notebookId: "math",
        pageId: "one",
        createdAt: Date.now(),
        subject: "Mathematik",
        language: "de",
        task: "2 + 2",
        prompt: "Private.",
      }),
    );
    body.set(
      "image",
      new Blob([Uint8Array.from([137, 80, 78, 71])], { type: "image/png" }),
      "answer.png",
    );
    return (
      await worker.fetch(
        request("/api/bridge/submission", "POST", body, actor, headers),
        hosted,
      )
    ).json();
  };
  assert.equal((await relay("GET", undefined, "wrong")).status, 401);
  assert.equal((await relay("GET")).status, 204);
  const visitorEmail = "visitor@example.test";
  const visitorId = "visitor";
  const { createHash } = await import("node:crypto");
  const visitorScope =
    "account-" + createHash("sha256").update(visitorId).digest("hex");
  assert.equal(
    (
      await upload("visitor-note", visitorId, {
        "oai-authenticated-user-email": visitorEmail,
        "x-inkloop-workspace": visitorScope,
      })
    ).queued,
    false,
  );
  assert.equal((await relay("GET")).status, 204);
  assert.equal((await upload("owner-note", "owner", owner)).queued, true);
  const job = await (await relay("GET")).formData();
  assert.deepEqual(JSON.parse(job.get("task")), {
    id: "owner-note",
    task: "2 + 2",
    subject: "Mathematik",
    language: "de",
  });
  assert.equal(job.get("image").type, "image/png");
  const answer = {
    submission_id: "owner-note",
    transcription: "4",
    feedback: "Richtig.",
  };
  assert.equal((await (await relay("POST", answer)).json()).saved, true);
  await relay("POST", answer);
  await upload("owner-note", "owner", owner);
  assert.equal((await relay("GET")).status, 204);
  const updates = await (
    await worker.fetch(
      request("/api/bridge", "GET", undefined, "owner", owner),
      hosted,
    )
  ).json();
  assert.equal(updates.events.length, 1);
  assert.equal(updates.events[0].feedback, "Richtig.");
});
