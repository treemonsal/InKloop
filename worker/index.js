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
    if ((await read(bucket, reviewKey(id)))?.prefix === prefix)
      await bucket.delete(reviewKey(id));
    await bucket.delete(reviewResultKey(prefix, id));
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
const submissionEvent = {
  name: "inkloop.submission.created",
  description:
    "A handwritten Inkloop answer was submitted. Use inkloop_read_submission with the supplied submission_id, then save the transcription and feedback to that exact submission with inkloop_write_response.",
  delivery: ["webhook"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  payloadSchema: {
    type: "object",
    properties: { submission_id: { type: "string" } },
    required: ["submission_id"],
    additionalProperties: false,
  },
};
const capabilities = { tools: {}, events: {} };
const subscriptionKey = (prefix) => prefix + "work/subscription.json";

function workCallback(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const firstParty =
      url.hostname === "chatgpt.com" ||
      url.hostname.endsWith(".chatgpt.com") ||
      url.hostname === "api.openai.com";
    if (
      firstParty &&
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash
    )
      return url.href;
  } catch {}
  return null;
}

function webhookKey(secret) {
  if (
    typeof secret !== "string" ||
    !/^whsec_[A-Za-z0-9+/]{32,88}={0,2}$/.test(secret)
  )
    return null;
  try {
    const bytes = Uint8Array.from(atob(secret.slice(6)), (char) =>
      char.charCodeAt(0),
    );
    return bytes.length >= 24 && bytes.length <= 64 ? bytes : null;
  } catch {
    return null;
  }
}

async function postWorkEvent(subscription, id, payload) {
  const url = workCallback(subscription.url);
  const secret = webhookKey(subscription.secret);
  if (!url || !secret) throw new Error("Invalid callback");
  const encoder = new TextEncoder();
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(id + "." + timestamp + "." + body),
  );
  return fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(4500),
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature":
        "v1," + btoa(String.fromCharCode(...new Uint8Array(signature))),
      "X-MCP-Subscription-Id": subscription.id,
    },
    body,
  });
}

async function workEventRpc(request, env, message, reply) {
  const error = (code, messageText, data) =>
    json({
      jsonrpc: "2.0",
      id: message.id ?? null,
      error: { code, message: messageText, data },
    });
  let owner;
  try {
    owner = (await workspaceScope(request, env)) === "workspace";
  } catch {}
  if (!owner)
    return error(-32001, "Inkloop account is not authorized for Work events.");
  if (message.method === "events/list")
    return reply({ events: [submissionEvent] });
  if (!["events/subscribe", "events/unsubscribe"].includes(message.method))
    return error(-32601, "Unknown event method");

  const { name, arguments: args = {}, delivery, ttlMs } = message.params || {};
  const url = workCallback(delivery?.url);
  if (
    name !== submissionEvent.name ||
    !args ||
    Array.isArray(args) ||
    typeof args !== "object" ||
    Object.keys(args).length ||
    delivery?.mode !== "webhook" ||
    !url
  )
    return error(-32602, "Unsupported Inkloop event or callback.");
  const bucket = assertBucket(env);
  const prefix = prefixFor(request);
  const key = subscriptionKey(prefix);
  const saved = await read(bucket, key);
  if (message.method === "events/unsubscribe") {
    if (saved?.url === url) await bucket.delete(key);
    return reply({});
  }
  if (
    !webhookKey(delivery.secret) ||
    (ttlMs != null && (!Number.isSafeInteger(ttlMs) || ttlMs <= 0))
  )
    return error(-32602, "Invalid webhook secret or expiry.");
  if (saved && saved.expires > Date.now() && saved.url !== url)
    return error(
      -32602,
      "Stop the existing Inkloop Work task before connecting another.",
    );

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(prefix + url),
  );
  const id =
    "sub_" +
    Array.from(new Uint8Array(digest), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
  const expires = Date.now() + Math.min(ttlMs ?? 7 * 86400000, 7 * 86400000);
  const subscription = { id, url, secret: delivery.secret, expires };
  if (
    saved?.url !== url ||
    saved.secret !== subscription.secret ||
    saved.expires <= Date.now()
  ) {
    const challenge = crypto.randomUUID();
    try {
      const res = await postWorkEvent(
        subscription,
        "verify_" + crypto.randomUUID(),
        {
          type: "verification",
          challenge,
        },
      );
      const result =
        res.ok &&
        JSON.parse(new TextDecoder().decode(await limitedBody(res, 4096)));
      if (
        typeof result?.challenge !== "string" ||
        result.challenge.length !== challenge.length
      )
        throw new Error("Invalid challenge");
      let diff = 0;
      for (let i = 0; i < challenge.length; i++)
        diff |= challenge.charCodeAt(i) ^ result.challenge.charCodeAt(i);
      if (diff !== 0) throw new Error("Invalid challenge");
    } catch {
      return error(-32015, "Callback verification failed.", {
        reason: "challenge_failed",
      });
    }
  }
  await put(bucket, key, subscription);
  return reply({
    id,
    refreshBefore: new Date(expires).toISOString(),
    cursor: null,
    truncated: false,
  });
}

async function signalWork(request, env, bucket, prefix, metadata) {
  if (
    env.INKLOOP_WORK_INCLUDED_ONLY !== "1" ||
    !env.INKLOOP_LEGACY_OWNER_EMAIL ||
    (await workspaceScope(request, env)) !== "workspace"
  )
    return false;
  const subscription = await read(bucket, subscriptionKey(prefix));
  if (!subscription || subscription.expires <= Date.now()) return false;
  const eventId = "inkloop_" + metadata.id;
  const deliveryKey = prefix + "work/deliveries/" + metadata.id;
  const claimed = await bucket.put(
    deliveryKey,
    JSON.stringify({ state: "sending" }),
    { onlyIf: firstWrite },
  );
  if (!claimed) {
    const previous = await read(bucket, deliveryKey);
    return previous?.state === "accepted" || previous?.state === "sending";
  }
  const payload = {
    eventId,
    name: submissionEvent.name,
    timestamp: new Date().toISOString(),
    data: { submission_id: metadata.id },
    cursor: null,
  };
  let state = "failed";
  try {
    const response = await postWorkEvent(subscription, eventId, payload);
    if (response.ok) state = "accepted";
    if (response.status === 410) await bucket.delete(subscriptionKey(prefix));
  } catch {
    // Delivery may already have started. A repeated upload must not start another run.
  }
  await put(bucket, deliveryKey, { state });
  return state === "accepted";
}

const reviewQueue = "review/queue/";
const reviewKey = (id) => reviewQueue + id + ".json";
const reviewResultKey = (prefix, id) =>
  prefix + "review/results/" + id + ".json";

async function enqueueReview(request, env, bucket, prefix, metadata) {
  if (!env.INKLOOP_REVIEW_KEY || !env.INKLOOP_LEGACY_OWNER_EMAIL) return false;
  if ((await workspaceScope(request, env)) !== "workspace") return false;
  const { id } = metadata;
  if (!(await bucket.get(reviewResultKey(prefix, id))))
    await bucket.put(reviewKey(id), JSON.stringify({ id, prefix }), {
      onlyIf: firstWrite,
    });
  return true;
}

async function reviewRelay(request, env) {
  const supplied = request.headers.get("x-inkloop-review-key") || "";
  const expected = env.INKLOOP_REVIEW_KEY;
  if (!expected || supplied.length !== expected.length)
    return json({ error: "AUTH_REQUIRED" }, 401);
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  if (difference) return json({ error: "AUTH_REQUIRED" }, 401);
  const bucket = assertBucket(env);
  if (request.method === "GET") {
    for await (const { key, value: job } of records(bucket, reviewQueue)) {
      const submission = submissionKey(job.prefix, job.id);
      const metadata = await read(bucket, submission + ".json");
      const image = await bucket.get(submission + ".png");
      if (
        !metadata ||
        !image ||
        (await bucket.get(deletedKey(job.prefix, job.id)))
      ) {
        await bucket.delete(key);
        continue;
      }
      const task = JSON.stringify({
        id: job.id,
        task: metadata.task,
        subject: metadata.subject,
        language: metadata.language,
      });
      const form = new FormData();
      form.set("task", task);
      form.set(
        "image",
        new Blob([await image.arrayBuffer()], { type: "image/png" }),
        "answer.png",
      );
      return new Response(form, { headers: { "cache-control": "no-store" } });
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }
  if (request.method !== "POST") return json({ error: "METHOD" }, 405);
  const args = JSON.parse(
    new TextDecoder().decode(await limitedBody(request, 80_000)),
  );
  const id = args.submission_id;
  if (
    !validId(id) ||
    !text(args.transcription, 20_000) ||
    !text(args.feedback, 20_000)
  )
    return json({ error: "INVALID_REVIEW" }, 400);
  const job = await read(bucket, reviewKey(id));
  if (!job) return json({ saved: false });
  const metadata = await read(bucket, submissionKey(job.prefix, id) + ".json");
  const tombstone = deletedKey(job.prefix, id);
  if (!metadata || (await bucket.get(tombstone))) {
    await bucket.delete(reviewKey(id));
    return json({ error: "DELETED" }, 410);
  }
  const result = {
    type: "response",
    submissionId: id,
    notebookId: metadata.notebookId,
    pageId: metadata.pageId,
    transcription: args.transcription,
    feedback: args.feedback,
    nextTask: "",
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const receipt = reviewResultKey(job.prefix, id);
  const created = await bucket.put(receipt, JSON.stringify(result), {
    onlyIf: firstWrite,
  });
  const saved = created ? result : await read(bucket, receipt);
  const key = eventKey(job.prefix, saved);
  await bucket.put(key, JSON.stringify(saved), { onlyIf: firstWrite });
  if (await bucket.get(tombstone)) {
    await bucket.delete(key);
    await bucket.delete(receipt);
    return json({ error: "DELETED" }, 410);
  }
  await bucket.delete(reviewKey(id));
  return json({ saved: true });
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
  if (message.method?.startsWith("events/"))
    return workEventRpc(request, env, message, reply);
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
    const automatic = await signalWork(request, env, bucket, prefix, metadata);
    const queued =
      !automatic &&
      (await enqueueReview(request, env, bucket, prefix, metadata));
    return json({
      ok: true,
      id: metadata.id,
      automatic: automatic || queued,
      queued,
    });
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
      if (url.pathname === "/api/review/relay")
        return await reviewRelay(request, env);
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
