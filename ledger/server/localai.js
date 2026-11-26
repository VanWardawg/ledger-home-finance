// A third way to the AI features: a model the household runs itself, reached directly.
//
// Ollama, LM Studio, llama.cpp's server and others all answer the same "OpenAI-compatible" requests
// (GET /v1/models, POST /v1/chat/completions). Ledger is given the address of one of them and the name of
// a model, and nothing about the household's money leaves the home network: the figures go from this
// server to that one and no further. Nothing is charged to anyone.
//
// What goes this way is the basic set that Home Assistant's AI gets (the dashboard recap, category
// suggestions), the money review (server/analysis.js), and a CFO that can look things up step by step when
// the model supports tool calls. Reading receipts, statements and pay stubs, finding logos and the
// official-site searches still need an Anthropic key.
//
//   settings   ai_via ('local' when chosen), ai_local_url, ai_local_model
//   optional   LEDGER_LOCAL_AI_URL and LEDGER_LOCAL_AI_MODEL fill the boxes in for a new copy
//              LEDGER_LOCAL_AI_KEY is sent as a bearer token, for a server that asks for one
import { db, getSetting, setSetting } from './db.js';

const TIMEOUT = 180_000;     // a model that has to be loaded from disk first can take a minute
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/** A server address as Ledger keeps it: http or https, no path beyond an optional prefix, no /v1 on the end. '' if it isn't one. */
export function cleanUrl(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';   // a password in an address ends up in logs
  const path = u.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '').replace(/\/api$/i, '');
  return `${u.protocol}//${u.host}${path}`;
}

export const localUrl = () => cleanUrl(getSetting('ai_local_url') || process.env.LEDGER_LOCAL_AI_URL || '');
export const localModel = () => String(getSetting('ai_local_model') || process.env.LEDGER_LOCAL_AI_MODEL || '').trim();
/** Whether the household has chosen its own model for the AI features. */
export const viaLocal = () => getSetting('ai_via') === 'local' && localUrl() !== '' && localModel() !== '';

const headers = () => {
  const key = String(process.env.LEDGER_LOCAL_AI_KEY || '').trim();
  return { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
};

/** Says what went wrong in words a person can act on. Never passes the other server's own text to the page. */
function readable(e, url) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new Error('Your model took too long to answer. A large model can need a minute to load: try again, or choose a smaller one.');
  if (e instanceof TypeError) return new Error(`Ledger couldn't reach a model server at ${url}. Check the address, that the server is running, and that it accepts connections from other machines (for Ollama, OLLAMA_HOST=0.0.0.0).`);
  return e;
}

/** The models a server offers, for the menu. Throws with a plain reason when it can't be asked. */
export async function localModels(url = localUrl()) {
  const base = cleanUrl(url);
  if (!base) throw new Error('Type the address of your model server, for example http://192.168.1.20:11434.');
  let res;
  try { res = await fetch(`${base}/v1/models`, { headers: headers(), signal: AbortSignal.timeout(15_000) }); } catch (e) { throw readable(e, base); }
  if (!res.ok) throw new Error(`The server at ${base} answered with an error (${res.status}). Ledger needs one that offers OpenAI-compatible requests, as Ollama and LM Studio do.`);
  let body;
  try { body = await res.json(); } catch { throw new Error(`The server at ${base} gave an answer Ledger couldn't read.`); }
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  return list.map((m) => String(m?.id || m?.name || '')).filter(Boolean).filter((id) => !/embed/i.test(id)).sort().slice(0, 200);
}

/** A model's answer with its private working taken out (some local models write it between <think> tags). */
export const withoutThinking = (text) => String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();

function note(feature, model, usage, sent) {
  try {
    db.prepare('INSERT INTO ai_usage (at, month, feature, model, source, input_tokens, output_tokens, cost, sent) VALUES (?,?,?,?,?,?,?,0,?)')
      .run(Date.now(), thisMonth(), feature, `local:${model}`.slice(0, 120), 'local', Number(usage?.prompt_tokens) || 0, Number(usage?.completion_tokens) || 0, String(sent || '').slice(0, 300));
  } catch { /* the reply still stands */ }
}

/**
 * Whether the server is Ollama, which is asked in its own way (below). Looked up once per address and
 * remembered; any other server is spoken to in the common OpenAI-compatible form.
 */
const kinds = new Map();
export async function serverKind(base = localUrl()) {
  if (kinds.has(base)) return kinds.get(base);
  let kind = 'openai';
  try {
    const res = await fetch(`${base}/api/version`, { headers: headers(), signal: AbortSignal.timeout(8000) });
    if (res.ok && typeof (await res.json())?.version === 'string') kind = 'ollama';
  } catch { /* not Ollama, or not reachable: the request itself will say which */ }
  kinds.set(base, kind);
  return kind;
}

/** How much the model is given to read at once, in tokens (setting `ai_local_ctx`, 4,096 to 131,072; 16,384 unless set). Ollama only. */
export const contextSize = () => { const n = Number(getSetting('ai_local_ctx') || process.env.LEDGER_LOCAL_AI_CTX); return Number.isInteger(n) && n >= 4096 && n <= 131072 ? n : 16384; };

// Ollama's own request. Two things the common form can't say matter here. First, how much the model may
// read: Ollama's default is small and it drops the start of anything longer without a word, which for
// Ledger would be the instructions. Second, whether the model should think before answering: a "thinking"
// model otherwise spends its whole reply on working nobody sees. Writing up finished figures needs none;
// choosing what to look up does.
async function ollamaChat(base, model, messages, { tools, json, maxTokens, temperature, think }) {
  const body = {
    model, stream: false, think: !!think,
    messages: messages.map((m) => (m.role === 'tool' ? { role: 'tool', content: m.content, tool_name: m.name }
      : m.tool_calls ? { role: 'assistant', content: m.content || '', tool_calls: m.tool_calls.map((c) => ({ function: { name: c.function.name, arguments: JSON.parse(c.function.arguments || '{}') } })) }
        : { role: m.role, content: m.content })),
    options: { num_ctx: contextSize(), temperature, num_predict: maxTokens },
    ...(tools?.length ? { tools } : {}),
    ...(json ? { format: 'json' } : {}),
  };
  const send = (b) => fetch(`${base}/api/chat`, { method: 'POST', headers: headers(), body: JSON.stringify(b), signal: AbortSignal.timeout(TIMEOUT) });
  let res = await send(body);
  // A model that can't think says so; it is asked again without the word.
  if (res.status === 400) { const { think: _t, ...plain } = body; const again = await send(plain); if (again.ok || !tools?.length) res = again; }
  if (res.status === 400 && tools?.length) { const e = new Error(`"${model}" can't look things up step by step (it doesn't support tool calls).`); e.noTools = true; throw e; }
  if (res.status === 404) throw new Error(`Your model server doesn't have a model called "${model}" any more. Choose one again in Settings.`);
  if (!res.ok) throw new Error(`Your model server answered with an error (${res.status}). Check that "${model}" still runs there.`);
  let out;
  try { out = await res.json(); } catch { throw new Error("Your model server gave an answer Ledger couldn't read. Try again."); }
  return {
    content: out?.message?.content, cut: out?.done_reason === 'length',
    toolCalls: (out?.message?.tool_calls || []).map((c, i) => ({ id: `call_${i}`, function: c.function })),
    usage: { prompt_tokens: out?.prompt_eval_count, completion_tokens: out?.eval_count },
  };
}

async function openaiChat(base, model, messages, { tools, json, maxTokens, temperature, think }) {
  const body = {
    model, stream: false, temperature, max_tokens: maxTokens,
    messages: messages.map((m) => (m.role === 'tool' ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content } : m)),
    ...(tools?.length ? { tools } : {}),
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const send = (b) => fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: headers(), body: JSON.stringify(b), signal: AbortSignal.timeout(TIMEOUT) });
  // Asked not to think where the server knows the word; one that refuses it is asked again without.
  let res = think ? await send(body) : await send({ ...body, reasoning_effort: 'none' });
  if (res.status === 400 && !think) res = await send(body);
  if (res.status === 404) throw new Error(`Your model server doesn't have a model called "${model}" any more. Choose one again in Settings.`);
  if (res.status === 400 && tools?.length) { const e = new Error(`"${model}" can't look things up step by step (it doesn't support tool calls).`); e.noTools = true; throw e; }
  if (!res.ok) throw new Error(`Your model server answered with an error (${res.status}). Check that "${model}" still runs there.`);
  let out;
  try { out = await res.json(); } catch { throw new Error("Your model server gave an answer Ledger couldn't read. Try again."); }
  const message = out?.choices?.[0]?.message || {};
  return { content: message.content, cut: out?.choices?.[0]?.finish_reason === 'length', toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [], usage: out?.usage };
}

/**
 * One request to the household's own model. `messages` are in the OpenAI form (a tool's answer carries
 * both `tool_call_id` and `name`). `tools`, when given, are offered to the model; the reply's calls are
 * handed back for the caller to run. `think` lets a thinking model reason first.
 * Returns { text, calls, message } where `message` is the assistant's turn as it should be sent back.
 */
export async function localChat(messages, { tools, json, feature = 'cfo', sent = '', maxTokens = 2000, temperature = 0.2, think = false } = {}) {
  if (!viaLocal()) throw new Error("A model of your own isn't switched on for Ledger.");
  const base = localUrl(), model = localModel();
  let out;
  try { out = await ((await serverKind(base)) === 'ollama' ? ollamaChat : openaiChat)(base, model, messages, { tools, json, maxTokens, temperature, think }); } catch (e) { throw readable(e, base); }
  note(feature, model, out.usage, sent);
  const calls = out.toolCalls.filter((c) => c?.function?.name).map((c, i) => {
    let input = c.function.arguments;
    if (typeof input === 'string') { try { input = JSON.parse(input || '{}'); } catch { input = {}; } }
    return { id: String(c.id || `call_${i}`), name: String(c.function.name), input: input && typeof input === 'object' ? input : {} };
  });
  const text = withoutThinking(out.content);
  if (!text && !calls.length && out.cut) throw new Error('Your model ran out of room before it answered. Try again, or choose a model that thinks less before answering.');
  return {
    text, calls,
    // Sent back as plain fields only, so nothing a server added (its own working, for one) is echoed to it.
    message: { role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) },
  };
}

/** Instructions in, text out: the same shape as Home Assistant's AI (server/haai.js), so either can stand in. */
export async function localAsk(task, instructions, feature, sent = '') {
  const { text } = await localChat([{ role: 'user', content: String(instructions).slice(0, 120_000) }], { feature, sent });
  if (!text) throw new Error('Your model gave no answer. Try again.');
  return text;
}

/** The first whole JSON value in a piece of text. Models wrap JSON in words and code fences. */
export function digJson(text) {
  const start = text.search(/[[{]/);
  if (start >= 0) {
    const open = text[start], close = open === '[' ? ']' : '}';
    for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* try a shorter piece */ }
    }
  }
  return undefined;
}

/** The same, for an answer wanted as JSON. */
export async function localAskJson(task, instructions, feature, sent = '') {
  const text = await localAsk(task, `${instructions}\n\nAnswer with JSON only: no words before or after it, and no code fence.`, feature, sent);
  const value = digJson(text);
  if (value === undefined) throw new Error("Your model didn't answer in the form Ledger asked for. Try again, or choose a different model.");
  return value;
}

/** What Settings shows. The model list is fetched only when asked for, so a server that is off doesn't slow the page. */
export async function localStatus(withModels = false) {
  const out = { on: viaLocal(), url: localUrl(), model: localModel(), models: [], error: '' };
  if (withModels && out.url) { try { out.models = await localModels(out.url); } catch (e) { out.error = e.message; } }
  return out;
}

export function installLocalAi(app) {
  app.get('/api/ai/local', async (req, res) => res.json(await localStatus(req.query.models === '1')));
  // Looks at a server before anything is saved: which models does it offer?
  app.post('/api/ai/local/models', async (req, res) => {
    try { res.json({ url: cleanUrl(req.body?.url), models: await localModels(req.body?.url) }); } catch (e) { res.status(502).json({ error: e.message }); }
  });
  app.put('/api/ai/local', async (req, res) => {
    if (req.body?.on === false) {
      if (getSetting('ai_via') === 'local') setSetting('ai_via', '');
      return res.json(await localStatus());
    }
    const url = cleanUrl(req.body?.url ?? localUrl());
    const model = String(req.body?.model ?? localModel()).trim().slice(0, 120);
    if (!url) return res.status(400).json({ error: 'Type the address of your model server, for example http://192.168.1.20:11434.' });
    let models;
    try { models = await localModels(url); } catch (e) { return res.status(502).json({ error: e.message }); }
    if (!model || !models.includes(model)) return res.status(400).json({ error: models.length ? 'Choose one of the models that server offers.' : 'That server has no models yet. Add one there (for Ollama: ollama pull qwen3:8b), then come back.', models });
    const before = { via: getSetting('ai_via'), url: getSetting('ai_local_url'), model: getSetting('ai_local_model') };
    setSetting('ai_local_url', url);
    setSetting('ai_local_model', model);
    setSetting('ai_via', 'local');
    // Prove it answers before anything relies on it.
    try { await localAsk('a quick check', 'Reply with the single word: ready', 'check', 'a one-word test, to see that it answers'); } catch (e) {
      setSetting('ai_via', before.via); setSetting('ai_local_url', before.url); setSetting('ai_local_model', before.model);
      return res.status(502).json({ error: e.message });
    }
    res.json(await localStatus(true));
  });
}
