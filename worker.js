/****************************************************************************************
 *  Retool OpenAI API Adapter – Cloudflare Workers edition
 *****************************************************************************************/

const VALID_CLIENT_KEYS = new Set([
  "sk-demo-xxxxxx",
]);

const RETOOL_ACCOUNTS = [
  {
    domain_name: "xxxx.retool.com",
    x_xsrf_token: "xxx",
    accessToken: "xxxx",
    is_valid: true,
    last_used: 0,
    error_count: 0,
    agents: [],
  },
];

let AVAILABLE_MODELS = [];
let DEBUG_MODE = false;
let INITIALIZED = false;

function logDebug(msg) {
  if (DEBUG_MODE) console.log("[DEBUG]", msg);
}

async function retoolQueryAgents(acc) {
  const url = `https://${acc.domain_name}/api/agents`;
  const r = await fetch(url, {
    headers: {
      "x-xsrf-token": acc.x_xsrf_token,
      "Cookie": `accessToken=${acc.accessToken}`,
      "User-Agent": "Rever-Worker/1.0",
      Accept: "application/json",
    },
  });
  if (!r.ok) throw new Error(`agent query ${r.status}`);
  const data = await r.json();
  return data.agents;
}

async function retoolGetThreadId(acc, agentId) {
  const url = `https://${acc.domain_name}/api/agents/${agentId}/threads`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-xsrf-token": acc.x_xsrf_token,
      "Cookie": `accessToken=${acc.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: "", timezone: "" }),
  });
  if (!r.ok) throw new Error(`thread ${r.status}`);
  const data = await r.json();
  return data.id;
}

async function retoolSendMessage(acc, agentId, threadId, text) {
  const url = `https://${acc.domain_name}/api/agents/${agentId}/threads/${threadId}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "x-xsrf-token": acc.x_xsrf_token,
      "Cookie": `accessToken=${acc.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "text", text, timezone: "Asia/Shanghai" }),
  });
  if (!r.ok) throw new Error(`send ${r.status}`);
  const data = await r.json();
  return data.content.runId;
}

async function retoolGetMessage(acc, agentId, runId, timeoutMs = 300000) {
  const url = `https://${acc.domain_name}/api/agents/${agentId}/logs/${runId}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(url, {
      headers: {
        "x-xsrf-token": acc.x_xsrf_token,
        "Cookie": `accessToken=${acc.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!r.ok) throw new Error(`log ${r.status}`);
    const data = await r.json();
    if (data.status === "COMPLETED") {
      const trace = data.trace;
      const last = trace[trace.length - 1];
      return last.data.data.content;
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error("timeout");
}

function formatMessagesForRetool(msgs) {
  let out = "";
  for (const m of msgs) {
    const role = m.role === "user" ? "Human" : "Assistant";
    out += `\n\n${role}: ${m.content}`;
  }
  if (msgs.length && msgs[msgs.length - 1].role === "assistant") out += "\n\nHuman: ";
  return out;
}

function getBestAccount(modelId) {
  const rec = AVAILABLE_MODELS.find((m) => m.id === modelId);
  if (!rec) return undefined;
  const now = Date.now();
  const cands = RETOOL_ACCOUNTS.filter((acc) => {
    if (!acc.is_valid) return false;
    if (acc.error_count >= 3 && now - acc.last_used < 300000) return false;
    const ag = acc.agents.find((a) => rec.agents.includes(a.id));
    if (!ag) return false;
    acc.selected_agent_id = ag.id;
    return true;
  });
  if (!cands.length) return undefined;
  cands.sort((a, b) =>
    (a.last_used - b.last_used) || (a.error_count - b.error_count)
  );
  const chosen = cands[0];
  chosen.last_used = now;
  return chosen;
}

async function initializeRetoolEnvironment() {
  if (INITIALIZED) return;
  
  logDebug("Initializing Retool environment...");
  
  for (const acc of RETOOL_ACCOUNTS) {
    try {
      acc.agents = await retoolQueryAgents(acc);
      logDebug(`${acc.domain_name}: ${acc.agents.length} agents`);
    } catch (e) {
      console.error("agent fetch", e);
      acc.agents = [];
    }
  }
  
  const map = new Map();
  for (const acc of RETOOL_ACCOUNTS) {
    for (const ag of acc.agents) {
      const full = ag.data?.model ?? "unknown";
      const series = full.split("-").slice(0, 3).join("-");
      let rec = map.get(series);
      if (!rec) {
        rec = {
          id: series,
          name: ag.name,
          model_name: full,
          owned_by: full.toLowerCase().includes("claude") ? "anthropic" : "openai",
          agents: [],
        };
        map.set(series, rec);
      }
      rec.agents.push(ag.id);
    }
  }
  
  AVAILABLE_MODELS = [...map.values()];
  INITIALIZED = true;
  console.log(`Loaded ${AVAILABLE_MODELS.length} model families`);
}

async function* retoolStream(fullMsg, modelId) {
  const sid = crypto.randomUUID();
  const created = Math.floor(Date.now() / 1000);
  yield `data: ${JSON.stringify({
    id: sid,
    object: "chat.completion.chunk",
    created,
    model: modelId,
    choices: [{ delta: { role: "assistant" }, index: 0 }],
  })}\n\n`;
  for (let i = 0; i < fullMsg.length; i += 5) {
    const delta = fullMsg.slice(i, i + 5);
    yield `data: ${JSON.stringify({
      id: sid,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ delta: { content: delta }, index: 0 }],
    })}\n\n`;
    await new Promise((r) => setTimeout(r, 10));
  }
  yield `data: ${JSON.stringify({
    id: sid,
    object: "chat.completion.chunk",
    created,
    model: modelId,
    choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
  })}\n\ndata: [DONE]\n\n`;
}

async function* errorStream(msg, code = 503) {
  yield `data: ${JSON.stringify({ error: { message: msg, code } })}\n\n`;
  yield "data: [DONE]\n\n";
}

function streamResponse(gen, status = 200) {
  const stream = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const chunk of gen) {
          ctrl.enqueue(new TextEncoder().encode(chunk));
        }
        ctrl.close();
      } catch (e) {
        ctrl.error(e);
      }
    },
  });
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export default {
  async fetch(req) {
    // 在第一次请求时初始化
    await initializeRetoolEnvironment();

    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/debug" && req.method === "GET") {
      if (url.searchParams.has("enable")) {
        DEBUG_MODE = url.searchParams.get("enable") === "true";
      }
      return json({ 
        debug_mode: DEBUG_MODE,
        initialized: INITIALIZED,
        models_count: AVAILABLE_MODELS.length,
        accounts: RETOOL_ACCOUNTS.map(acc => ({
          domain: acc.domain_name,
          agents_count: acc.agents.length,
          is_valid: acc.is_valid,
          error_count: acc.error_count
        }))
      });
    }

    if (path === "/v1/models" && req.method === "GET") {
      const authErr = checkAuth(req);
      if (authErr) return authErr;
      return json(modelsPayload());
    }

    if (path === "/models" && req.method === "GET") {
      return json(modelsPayload());
    }

    if (path === "/v1/chat/completions" && req.method === "POST") {
      const authErr = checkAuth(req);
      if (authErr) return authErr;

      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid JSON" }, 400);
      }
      if (!body.messages?.length) return json({ error: "no messages" }, 400);
      if (!AVAILABLE_MODELS.find((m) => m.id === body.model)) {
        return json({ error: `model '${body.model}' not found` }, 404);
      }

      const formatted = formatMessagesForRetool(body.messages);
      logDebug(formatted.slice(0, 120) + "…");

      for (let i = 0; i < RETOOL_ACCOUNTS.length; ++i) {
        const acc = getBestAccount(body.model);
        if (!acc) break;
        const agentId = acc.selected_agent_id;
        try {
          const thread = await retoolGetThreadId(acc, agentId);
          const runId = await retoolSendMessage(acc, agentId, thread, formatted);
          const txt = await retoolGetMessage(acc, agentId, runId);

          if (body.stream) {
            return streamResponse(retoolStream(txt, body.model));
          }
          return json({
            id: `chatcmpl-${crypto.randomUUID()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{
              index: 0,
              message: { role: "assistant", content: txt },
              finish_reason: "stop",
            }],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          });
        } catch (e) {
          logDebug(`acc ${acc.domain_name} err: ${e}`);
          acc.error_count++;
          if (/401|403/.test(String(e))) acc.is_valid = false;
        }
      }

      if (body.stream) {
        return streamResponse(errorStream("all retool attempts failed"));
      }
      return json({ error: "all retool attempts failed" }, 503);
    }

    return json({ error: "not found" }, 404);
  },
};

function modelsPayload() {
  return {
    object: "list",
    data: AVAILABLE_MODELS.map((m) => ({
      id: m.id,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: m.owned_by,
      name: `${m.name} (${m.model_name})`,
    })),
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function checkAuth(req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return json({ error: "unauthorized" }, 401);
  if (!VALID_CLIENT_KEYS.has(m[1].trim())) return json({ error: "forbidden" }, 403);
}
