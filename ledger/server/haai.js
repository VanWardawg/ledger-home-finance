// A second way to the AI features: the AI a household has already set up in Home Assistant
// (2026-11-24, the owner: Home Assistant users "like the ability to personalize and they like privacy",
// so offer their own model as well as an Anthropic key).
//
// Home Assistant lets a person connect one AI (Claude, ChatGPT, Gemini, a model on their own machine) and
// offers it to the rest of the house as an "AI Task": the service ai_task.generate_data takes a name and
// instructions and hands back text. Ledger, running as an add-on with leave to call Home Assistant
// (homeassistant_api in its config), can use that in place of a key of its own.
//
// What goes that way is the BASIC set: the dashboard recap, category suggestions, and a plain-spoken CFO
// that answers from one bundle of figures. Everything that leans on Claude's own service still needs an
// Anthropic key: reading receipts, statements, pay stubs and pay calendars, drawing icons, finding logos,
// the CFO's step-by-step look-ups, its official-site searches and its proposed changes.
//
// Ledger cannot see which model is behind an AI Task. It is called Claude only where the task's name says
// so; otherwise the app drops Claude's name and the CFO is the "Chief Financial Officer".
//
//   settings   ai_via ('ha' when chosen), ai_ha_entity (which AI Task; empty for the house's preferred one),
//              ai_ha_name (its name as Home Assistant shows it)
//   for tests  LEDGER_HA_URL and LEDGER_HA_TOKEN stand in for the Supervisor's address and token
import { db, getSetting, setSetting } from './db.js';

const BASE = () => (process.env.LEDGER_HA_URL || 'http://supervisor/core/api').replace(/\/+$/, '');
const TOKEN = () => process.env.LEDGER_HA_TOKEN || process.env.SUPERVISOR_TOKEN || '';

/** Whether this copy can reach a Home Assistant at all (it is running as its add-on). */
export const haOffered = () => TOKEN() !== '';
/** Whether the household has chosen Home Assistant's AI for the basic features. */
export const viaHa = () => haOffered() && getSetting('ai_via') === 'ha';
export const haEntity = () => getSetting('ai_ha_entity');
/** Whether the chosen AI Task says it is Claude. A guess from its name: Ledger is told nothing else. */
export const haIsClaude = () => /claude|anthropic/i.test(`${haEntity()} ${getSetting('ai_ha_name')}`);
/** What to call the AI in the app: Claude when Ledger talks to Claude, otherwise a plain word. */
export const aiName = () => (viaHa() && !haIsClaude() ? 'your AI' : 'Claude');

async function call(method, path, body) {
  const res = await fetch(`${BASE()}${path}`, {
    method, signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${TOKEN()}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (res.status === 401 || res.status === 403) throw new Error("Home Assistant didn't let Ledger in. The add-on needs its permission to use Home Assistant: reinstall or update it, then try again.");
  if (!res.ok) throw new Error(`Home Assistant answered with an error (${res.status}). Check that its AI is set up under Settings, Devices & services.`);
  return res.json();
}

/** The AI Tasks this Home Assistant has, for the menu. Empty when it can't be asked. */
export async function haEntities() {
  if (!haOffered()) return [];
  try {
    const states = await call('GET', '/states');
    return (Array.isArray(states) ? states : []).filter((s) => String(s.entity_id).startsWith('ai_task.'))
      .map((s) => ({ id: s.entity_id, name: String(s.attributes?.friendly_name || s.entity_id) }));
  } catch { return []; }
}

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

/**
 * One request to Home Assistant's AI: instructions in, text out. `sent` says in plain words what went, for
 * the household's own record (Settings, "What has been sent"); nothing is charged to anyone by Ledger.
 */
export async function haAsk(task, instructions, feature, sent = '') {
  if (!viaHa()) throw new Error("Home Assistant's AI isn't switched on for Ledger.");
  const entity = haEntity();
  let out;
  try {
    out = await call('POST', '/services/ai_task/generate_data?return_response', { task_name: `Ledger: ${task}`.slice(0, 80), instructions: String(instructions).slice(0, 60000), ...(entity ? { entity_id: entity } : {}) });
  } catch (e) {
    throw e?.name === 'TimeoutError' || e?.name === 'AbortError' ? new Error("Home Assistant's AI took too long to answer.") : e instanceof TypeError ? new Error("Ledger couldn't reach Home Assistant.") : e;
  }
  const data = out?.service_response?.data ?? out?.data;
  const text = typeof data === 'string' ? data : data == null ? '' : JSON.stringify(data);
  try {
    db.prepare('INSERT INTO ai_usage (at, month, feature, model, source, input_tokens, output_tokens, cost, sent) VALUES (?,?,?,?,?,0,0,0,?)')
      .run(Date.now(), thisMonth(), feature, `home-assistant:${entity || 'preferred'}`, 'ha', String(sent).slice(0, 300));
  } catch { /* the reply still stands */ }
  if (!text.trim()) throw new Error("Home Assistant's AI gave no answer. Try again.");
  return text.trim();
}

/** The same, for an answer wanted as JSON. Models wrap JSON in words and code fences, so the first whole value is dug out. */
export async function haAskJson(task, instructions, feature, sent = '') {
  const text = await haAsk(task, `${instructions}\n\nAnswer with JSON only: no words before or after it, and no code fence.`, feature, sent);
  const start = text.search(/[[{]/);
  if (start >= 0) {
    const open = text[start], close = open === '[' ? ']' : '}';
    for (let end = text.lastIndexOf(close); end > start; end = text.lastIndexOf(close, end - 1)) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* try a shorter piece */ }
    }
  }
  throw new Error("Home Assistant's AI didn't answer in the form Ledger asked for. Try again, or use a different model there.");
}

/** What Settings shows and saves. */
export async function haStatus() {
  return { offered: haOffered(), on: viaHa(), entity: haEntity(), name: getSetting('ai_ha_name'), claude: !viaHa() || haIsClaude(), entities: haOffered() ? await haEntities() : [] };
}

export function installHaAi(app) {
  app.get('/api/ai/ha', async (_req, res) => res.json(await haStatus()));
  app.put('/api/ai/ha', async (req, res) => {
    if (!haOffered()) return res.status(400).json({ error: "This copy of Ledger isn't running inside Home Assistant, so it has no Home Assistant AI to use." });
    if (req.body?.on === false) { setSetting('ai_via', ''); return res.json(await haStatus()); }
    const list = await haEntities();
    const want = String(req.body?.entity ?? haEntity() ?? '');
    const found = list.find((e) => e.id === want) || (want === '' ? null : undefined);
    if (found === undefined) return res.status(400).json({ error: 'Choose one of the AI Tasks set up in your Home Assistant.' });
    if (!list.length) return res.status(400).json({ error: 'Your Home Assistant has no AI Task set up yet. Add an AI under Settings, Devices & services (Anthropic, OpenAI, Google, Ollama and others offer one), then come back.' });
    setSetting('ai_ha_entity', found ? found.id : '');
    setSetting('ai_ha_name', found ? found.name : '');
    setSetting('ai_via', 'ha');
    // Prove it answers before anything relies on it.
    if (req.body?.check !== false) {
      try { await haAsk('a quick check', 'Reply with the single word: ready', 'check', 'a one-word test, to see that it answers'); } catch (e) { setSetting('ai_via', ''); return res.status(502).json({ error: e.message }); }
    }
    res.json(await haStatus());
  });
}
