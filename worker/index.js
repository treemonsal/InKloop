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
const prefixFor = (request) => {
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id) throw new Error("AUTH_REQUIRED");
  return "users/" + encodeURIComponent(id) + "/";
};
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
async function event(bucket, prefix, payload) {
  const createdAt = Date.now(),
    id = crypto.randomUUID();
  const result = { ...payload, id, createdAt };
  await put(
    bucket,
    prefix +
      "events/" +
      String(createdAt).padStart(13, "0") +
      "-" +
      id +
      ".json",
    result,
  );
  return result;
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
  const reply = (result) =>
    json({ jsonrpc: "2.0", id: message.id ?? null, result });
  if (message.method === "server/discover")
    return reply({ supportedVersions: [VERSION], capabilities: { tools: {} } });
  if (message.method === "initialize")
    return reply({
      protocolVersion: VERSION,
      capabilities: { tools: {} },
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
      const latest = await read(bucket, prefix + "latest.json");
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
      const latest = await read(bucket, prefix + "latest.json"),
        id = args.submission_id || latest?.id;
      if (!validId(id))
        throw new Error(
          "Noch keine Abgabe vorhanden. Öffne Inkloop und tippe auf „Antwort abgeben“.",
        );
      const metadata = await read(
          bucket,
          prefix + "submissions/" + id + ".json",
        ),
        image = await bucket.get(prefix + "submissions/" + id + ".png");
      if (!metadata || !image) throw new Error("Abgabe nicht gefunden.");
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
        prefix + "submissions/" + args.submission_id + ".json",
      );
      if (!metadata)
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
  const bucket = assertBucket(env),
    prefix = prefixFor(request),
    url = new URL(request.url);
  assertSameOrigin(request);
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
      !validId(value.activeNotebook) ||
      !Array.isArray(value.notebooks) ||
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
    await bucket.put(
      prefix + "submissions/" + metadata.id + ".png",
      imageBytes,
      { httpMetadata: { contentType: "image/png" } },
    );
    await put(
      bucket,
      prefix + "submissions/" + metadata.id + ".json",
      metadata,
    );
    await put(bucket, prefix + "latest.json", {
      id: metadata.id,
      notebookId: metadata.notebookId,
      pageId: metadata.pageId,
      createdAt: metadata.createdAt,
      subject: metadata.subject,
    });
    return json({ ok: true, id: metadata.id });
  }
  return json({ error: "Not found" }, 404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/mcp") {
        if (request.method === "POST") return rpc(request, env);
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
      const binary = atob(asset.data),
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, {
        headers: {
          "content-type": asset.type,
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
