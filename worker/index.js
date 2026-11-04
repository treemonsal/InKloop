// Asset map is injected by the deterministic build; no user data is bundled.
const ASSETS = /* INKLOOP_ASSETS */ {};
const VERSION = "2026-07-28";
const tools = [
  {
    name: "inkloop_get_workspace",
    description:
      "Read Inkloop notebook/page identifiers and the latest submitted answer for the signed-in user. Use before setting a task or reading a submission. No model or API purchase is involved.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "inkloop_read_submission",
    description:
      "Read the original handwritten answer image and its exact task and handwriting reference instructions from Inkloop. If submission_id is omitted, read the latest submission. Transcribe literally, mark ambiguous characters, preserve mistakes, then tutor separately. Images can include labelled reference samples which are not part of the answer.",
    inputSchema: {
      type: "object",
      properties: {
        submission_id: {
          type: "string",
          description:
            "Submission UUID, or omit to read the most recent answer.",
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "inkloop_write_response",
    description:
      "Save your faithful transcription, separate tutoring feedback and optional next task back to the specified Inkloop submission. The open notebook receives the result automatically. Never silently correct the transcription. Only use after reading that submission.",
    inputSchema: {
      type: "object",
      properties: {
        submission_id: { type: "string" },
        transcription: { type: "string" },
        feedback: { type: "string" },
        next_task: { type: "string" },
      },
      required: ["submission_id", "transcription", "feedback"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "inkloop_set_task",
    description:
      "Send a learning task from this chat into the active Inkloop notebook, or into a notebook_id from inkloop_get_workspace. Inkloop fills a blank page or creates a new page if the active page already has handwriting. The user must have Inkloop open online to receive it.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string" },
        notebook_id: { type: "string" },
        language: { type: "string", enum: ["de", "en"] },
      },
      required: ["task"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
const validId = (id) =>
  typeof id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const text = (value, max = 200000) =>
  typeof value === "string" && value.length <= max;
const read = async (bucket, key) => {
  const object = await bucket.get(key);
  return object ? object.json() : null;
};
const put = (bucket, key, value) =>
  bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
const submissionKey = (prefix, id) => prefix + "submissions/" + id;
const deletedKey = (prefix, id) => prefix + "deleted/" + id;
const firstWrite = { etagDoesNotMatch: "*" };

async function* records(bucket, prefix) {
  let cursor;
  do {
    const list = await bucket.list({ prefix, cursor });
    for (const { key } of list.objects) {
      if (!key.endsWith(".json")) continue;
      const value = await read(bucket, key);
      if (value) yield { key, value };
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
}

async function latestSubmission(bucket, prefix) {
  const pointer = await read(bucket, prefix + "latest.json");
  let metadata =
    pointer &&
    (await read(bucket, submissionKey(prefix, pointer.id) + ".json"));
  if (!metadata || (await bucket.get(deletedKey(prefix, metadata.id)))) {
    metadata = null;
    for await (const { value } of records(bucket, prefix + "submissions/")) {
      if (
        (!metadata || value.createdAt > metadata.createdAt) &&
        !(await bucket.get(deletedKey(prefix, value.id)))
      ) {
        metadata = value;
      }
    }
  }
  if (!metadata) return null;
  const { id, notebookId, pageId, createdAt, subject } = metadata;
  return { id, notebookId, pageId, createdAt, subject };
}

async function deletePageCopies(bucket, prefix, pageId, submissionIds) {
  const ids = new Set(submissionIds);
  for await (const { value } of records(bucket, prefix + "submissions/")) {
    if (value.pageId === pageId) ids.add(value.id);
    else ids.delete(value.id);
  }
  for (const id of ids) {
    await put(bucket, deletedKey(prefix, id), true);
    const key = submissionKey(prefix, id);
    await bucket.delete(key + ".json");
    await bucket.delete(key + ".png");
  }
  for await (const { key, value } of records(bucket, prefix + "events/")) {
    if (value.type === "response" && value.pageId === pageId)
      await bucket.delete(key);
  }
  const latest = await read(bucket, prefix + "latest.json");
  if (ids.has(latest?.id)) await bucket.delete(prefix + "latest.json");
}

const prefixFor = (request) => {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new Error("AUTH_REQUIRED");
  return "users/" + encodeURIComponent(id) + "/";
};
async function workspaceScope(request, env) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) throw new Error("AUTH_REQUIRED");
  if (email.toLowerCase() === env.INKLOOP_LEGACY_OWNER_EMAIL?.toLowerCase())
    return "workspace";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(id),
  );
  return (
    "account-" +
    Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

const assertBucket = (env) => {
  if (!env.BUCKET) throw new Error("BRIDGE_UNAVAILABLE");
  return env.BUCKET;
};
const assertSameOrigin = (request) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Error("ORIGIN_REJECTED");
};
async function limitedBody(request, max) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > max) throw new Error("PAYLOAD_TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("EMPTY_BODY");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error("PAYLOAD_TOO_LARGE");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return buffer;
}
const eventKey = (prefix, { createdAt, id }) =>
  prefix + "events/" + String(createdAt).padStart(13, "0") + "-" + id + ".json";
async function event(bucket, prefix, payload) {
  const createdAt = Date.now(),
    id = crypto.randomUUID();
  const result = { ...payload, id, createdAt };
  await put(bucket, eventKey(prefix, result), result);
  await pruneEvents(bucket, prefix, createdAt);
  return result;
}
// Events are only a delivery queue; the notebook keeps the result locally.
const EVENT_RETENTION_MS = 90 * 86400000;
async function pruneEvents(bucket, prefix, now) {
  const start = prefix + "events/";
  const cutoff =
    start + String(Math.max(0, now - EVENT_RETENTION_MS)).padStart(13, "0");
  const list = await bucket.list({ prefix: start, limit: 100 });
  for (const { key } of list.objects)
    if (key < cutoff) await bucket.delete(key);
}
async function pendingEvents(bucket, prefix, after) {
  const start = prefix + "events/";
  const list = await bucket.list({
    prefix: start,
    startAfter: start + after,
    limit: 100,
  });
  const objects = await Promise.all(
    list.objects.map((o) => read(bucket, o.key)),
  );
  return {
    events: objects.filter(Boolean),
    cursor: list.objects.length
      ? list.objects.at(-1).key.slice(start.length)
      : after,
  };
}
const capabilities = { tools: {} };

async function rpc(request, env) {
  let message;
  try {
    message = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 1_000_000)),
    );
  } catch {
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid request" },
      },
      400,
    );
  }
  if (!message || typeof message !== "object" || Array.isArray(message))
    return json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid request" },
      },
      400,
    );
  const reply = (result) =>
    json({ jsonrpc: "2.0", id: message.id ?? null, result });
  if (message.method === "server/discover")
    return reply({
      resultType: "complete",
      supportedVersions: [VERSION],
      capabilities,
    });
  if (message.method === "initialize")
    return reply({
      protocolVersion: VERSION,
      capabilities,
      serverInfo: { name: "Inkloop", version: "1.1.0" },
      instructions:
        "Inkloop is the user’s handwritten learning notebook. Use its tools to read submitted images, deliver faithful transcriptions and tutoring feedback, and place tasks into the notebook. No paid model API is invoked by Inkloop.",
    });
  if (message.method === "notifications/initialized")
    return new Response(null, { status: 202 });
  if (message.method === "ping") return reply({});
  if (message.method === "tools/list") return reply({ tools });
  if (message.method !== "tools/call")
    return json({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code: -32601, message: "Method not found" },
    });
  try {
    const bucket = assertBucket(env),
      prefix = prefixFor(request),
      args = message.params?.arguments || {},
      name = message.params?.name;
    if (name === "inkloop_get_workspace") {
      const workspace = await read(bucket, prefix + "workspace.json");
      const latest = await latestSubmission(bucket, prefix);
      return reply({
        content: [
          {
            type: "text",
            text: JSON.stringify({ workspace, latest_submission: latest }),
          },
        ],
      });
    }
    if (name === "inkloop_read_submission") {
      const id =
        args.submission_id || (await latestSubmission(bucket, prefix))?.id;
      if (!validId(id))
        throw new Error(
          "Noch keine Abgabe vorhanden. Öffne Inkloop und tippe auf „Antwort abgeben“.",
        );
      const key = submissionKey(prefix, id);
      const metadata = await read(bucket, key + ".json");
      const image = await bucket.get(key + ".png");
      if (!metadata || !image || (await bucket.get(deletedKey(prefix, id))))
        throw new Error("Abgabe nicht gefunden.");
      const bytes = new Uint8Array(await image.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return reply({
        content: [
          { type: "text", text: JSON.stringify(metadata) },
          { type: "image", mimeType: "image/png", data: btoa(binary) },
        ],
      });
    }
    if (name === "inkloop_write_response") {
      if (
        !validId(args.submission_id) ||
        !text(args.transcription) ||
        !text(args.feedback) ||
        !text(args.next_task ?? "")
      )
        throw new Error("Ungültige Antwortfelder.");
      const metadata = await read(
        bucket,
        submissionKey(prefix, args.submission_id) + ".json",
      );
      if (
        !metadata ||
        (await bucket.get(deletedKey(prefix, args.submission_id)))
      )
        throw new Error(
          "Abgabe nicht gefunden. Lies zuerst die richtige Abgabe.",
        );
      const result = await event(bucket, prefix, {
        type: "response",
        submissionId: args.submission_id,
        notebookId: metadata.notebookId,
        pageId: metadata.pageId,
        transcription: args.transcription,
        feedback: args.feedback,
        nextTask: args.next_task || "",
      });
      if (await bucket.get(deletedKey(prefix, args.submission_id))) {
        await bucket.delete(eventKey(prefix, result));
        throw new Error("Diese Abgabe wurde gelöscht.");
      }
      return reply({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: true,
              submission_id: args.submission_id,
              event_id: result.id,
              message:
                "Inkloop übernimmt die Antwort, sobald das Lernheft online geöffnet ist.",
            }),
          },
        ],
      });
    }
    if (name === "inkloop_set_task") {
      if (
        !text(args.task) ||
        !args.task.trim() ||
        (args.language && !["de", "en"].includes(args.language))
      )
        throw new Error("Ungültige Aufgabe.");
      const workspace = await read(bucket, prefix + "workspace.json");
      const notebookId = args.notebook_id || workspace?.activeNotebook;
      if (
        !validId(notebookId) ||
        !workspace?.notebooks?.some((n) => n.id === notebookId)
      )
        throw new Error("Lernheft nicht gefunden. Öffne zuerst Inkloop.");
      const result = await event(bucket, prefix, {
        type: "task",
        notebookId,
        task: args.task,
        language: args.language || null,
      });
      return reply({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              saved: true,
              event_id: result.id,
              message: "Die Aufgabe wird im geöffneten Lernheft empfangen.",
            }),
          },
        ],
      });
    }
    throw new Error("Unknown tool");
  } catch (e) {
    return reply({
      isError: true,
      content: [
        {
          type: "text",
          text:
            e.message === "AUTH_REQUIRED"
              ? "Bitte Inkloop und das Plugin mit demselben ChatGPT-Konto öffnen."
              : e.message === "BRIDGE_UNAVAILABLE"
                ? "Die Verbindung ist noch nicht verfügbar. Nutze die Bildübergabe."
                : e.message,
        },
      ],
    });
  }
}
async function api(request, env) {
  const url = new URL(request.url);
  assertSameOrigin(request);
  if (request.method === "GET" && url.pathname === "/api/session") {
    return json({ workspace: await workspaceScope(request, env) });
  }
  const bucket = assertBucket(env),
    prefix = prefixFor(request);
  if (
    env.INKLOOP_LEGACY_OWNER_EMAIL &&
    request.headers.get("x-inkloop-workspace") !==
      (await workspaceScope(request, env))
  )
    return json({ error: "WORKSPACE_CHANGED" }, 409);
  if (request.method === "GET" && url.pathname === "/api/bridge") {
    const after = url.searchParams.get("after") || "";
    if (after && !/^[0-9]{13}-[a-f0-9-]{36}\.json$/.test(after))
      return json({ error: "Invalid cursor" }, 400);
    return json({ ok: true, ...(await pendingEvents(bucket, prefix, after)) });
  }
  if (request.method === "PUT" && url.pathname === "/api/bridge/workspace") {
    const value = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 500000)),
    );
    if (
      !Array.isArray(value.notebooks) ||
      (value.notebooks.length
        ? !validId(value.activeNotebook)
        : value.activeNotebook !== "" || value.activePage !== "") ||
      value.notebooks.length > 200 ||
      !value.notebooks.every(
        (n) =>
          validId(n.id) &&
          text(n.name, 150) &&
          text(n.subject, 150) &&
          ["de", "en"].includes(n.language),
      )
    )
      return json({ error: "Ungültiger Lernheftindex." }, 400);
    await put(bucket, prefix + "workspace.json", value);
    return json({ ok: true });
  }
  if (
    request.method === "DELETE" &&
    url.pathname.startsWith("/api/bridge/page/")
  ) {
    const pageId = url.pathname.slice("/api/bridge/page/".length);
    const value = JSON.parse(
      new TextDecoder().decode(await limitedBody(request, 500000)),
    );
    if (
      !validId(pageId) ||
      !Array.isArray(value?.submissionIds) ||
      !value.submissionIds.every(validId)
    )
      return json({ error: "Ungültige Seite oder Abgaben." }, 400);
    await deletePageCopies(bucket, prefix, pageId, value.submissionIds);
    return json({ ok: true });
  }
  if (request.method === "POST" && url.pathname === "/api/bridge/submission") {
    const buffer = await limitedBody(request, 12_000_000);
    const form = await new Response(buffer, {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
    const raw = form.get("metadata"),
      image = form.get("image");
    if (
      typeof raw !== "string" ||
      !image ||
      typeof image === "string" ||
      image.type !== "image/png" ||
      image.size > 10_000_000
    )
      return json({ error: "PNG und Metadaten erforderlich." }, 400);
    const metadata = JSON.parse(raw);
    if (
      !validId(metadata.id) ||
      !validId(metadata.notebookId) ||
      !validId(metadata.pageId) ||
      !Number.isFinite(metadata.createdAt) ||
      !text(metadata.prompt, 210000) ||
      !text(metadata.task) ||
      !text(metadata.subject, 150) ||
      !["de", "en"].includes(metadata.language)
    )
      return json({ error: "Ungültige Abgabe." }, 400);
    const imageBytes = await image.arrayBuffer();
    const bytes = new Uint8Array(imageBytes);
    if (
      bytes[0] !== 137 ||
      bytes[1] !== 80 ||
      bytes[2] !== 78 ||
      bytes[3] !== 71
    )
      return json({ error: "Ungültiges PNG." }, 400);
    const key = submissionKey(prefix, metadata.id);
    const tombstone = deletedKey(prefix, metadata.id);
    if (await bucket.get(tombstone))
      return json({ error: "Diese Abgabe wurde gelöscht." }, 409);
    const existing = await read(bucket, key + ".json");
    if (
      existing &&
      (existing.pageId !== metadata.pageId ||
        existing.notebookId !== metadata.notebookId)
    )
      return json({ error: "Die Abgabe gehört zu einer anderen Seite." }, 409);
    await bucket.put(key + ".png", imageBytes, {
      onlyIf: firstWrite,
      httpMetadata: { contentType: "image/png" },
    });
    const created = await bucket.put(key + ".json", JSON.stringify(metadata), {
      onlyIf: firstWrite,
      httpMetadata: { contentType: "application/json" },
    });
    if (created) await put(bucket, prefix + "latest.json", { id: metadata.id });
    if (await bucket.get(tombstone)) {
      await bucket.delete(key + ".json");
      await bucket.delete(key + ".png");
      const latest = await read(bucket, prefix + "latest.json");
      if (latest?.id === metadata.id)
        await bucket.delete(prefix + "latest.json");
      return json({ error: "Diese Abgabe wurde gelöscht." }, 409);
    }
    return json({ ok: true, id: metadata.id, automatic: false });
  }
  return json({ error: "Not found" }, 404);
}
const decoded = new Map();
// Conservative policy that cannot block scripts the hosting platform may inject.
const CSP = "object-src 'none'; base-uri 'self'; form-action 'self'";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/mcp") {
        if (request.method === "POST") return await rpc(request, env);
        return new Response("Inkloop MCP", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      if (!["GET", "HEAD"].includes(request.method))
        return new Response("Method not allowed", { status: 405 });
      const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1),
        asset = ASSETS[path];
      if (!asset) return new Response("Not found", { status: 404 });
      let bytes = decoded.get(path);
      if (!bytes) {
        bytes = Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0));
        decoded.set(path, bytes);
      }
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "content-type": asset.type,
          ...(path === "index.html" ? { "content-security-policy": CSP } : {}),
          "cache-control": path.startsWith("assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
        },
      });
    } catch (e) {
      const status =
        e.message === "AUTH_REQUIRED"
          ? 401
          : e.message === "ORIGIN_REJECTED"
            ? 403
            : e.message === "PAYLOAD_TOO_LARGE"
              ? 413
              : e.message === "BRIDGE_UNAVAILABLE"
                ? 503
                : 400;
      return json({ error: e.message }, status);
    }
  },
};
