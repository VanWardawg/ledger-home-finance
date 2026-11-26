// A model of the household's own, against two stand-in servers on this machine: one that answers as
// Ollama does and one that answers in the common OpenAI-compatible form. Also the nightly backup.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

process.env.LEDGER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-test-'));
process.env.LEDGER_FRESH = '1';
process.env.LEDGER_NO_TIMERS = '1';
const { db, setSetting, getSetting } = await import('../server/db.js');
await import('../server/ai.js');   // makes the ai_usage table
const { cleanUrl, withoutThinking, digJson, localModels, localChat, localAsk, localAskJson, viaLocal, serverKind } = await import('../server/localai.js');
const { viaPlain, aiName, plainRoute } = await import('../server/plainai.js');
const backup = await import('../server/backup.js');

/** A stand-in model server. `handler(path, body)` returns [status, json]. Every request is kept in `seen`. */
async function fake(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ path: req.url, body });
      const [status, json] = handler(req.url, body);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((ok) => server.close(ok)) };
}
const use = (url, model) => { setSetting('ai_local_url', url); setSetting('ai_local_model', model); setSetting('ai_via', 'local'); };

test('addresses are tidied and anything that is not a web address is refused', () => {
  assert.equal(cleanUrl('192.168.1.20:11434'), 'http://192.168.1.20:11434');
  assert.equal(cleanUrl('http://pc.local:11434/v1/'), 'http://pc.local:11434');
  assert.equal(cleanUrl('https://ai.example/openai/v1'), 'https://ai.example/openai');
  assert.equal(cleanUrl('file:///etc/passwd'), '');
  assert.equal(cleanUrl('http://user:secret@host:1'), '');
  assert.equal(cleanUrl(''), '');
});

test("a model's private working is taken out of its answer", () => {
  assert.equal(withoutThinking('<think>let me see</think>\nForty-two.'), 'Forty-two.');
  assert.equal(withoutThinking('still working</think>Done.'), 'Done.');
  assert.equal(withoutThinking('Plain.'), 'Plain.');
});

test('JSON is dug out of whatever a model wraps it in', () => {
  assert.deepEqual(digJson('Sure! ```json\n[{"number": 1, "category": "Groceries"}]\n``` Hope that helps.'), [{ number: 1, category: 'Groceries' }]);
  assert.deepEqual(digJson('{"a": {"b": 1}} trailing }'), { a: { b: 1 } });
  assert.equal(digJson('no json here'), undefined);
});

test('it is off until a server and a model are chosen', () => {
  setSetting('ai_via', ''); setSetting('ai_local_url', ''); setSetting('ai_local_model', '');
  assert.equal(viaLocal(), false);
  assert.equal(viaPlain(), false);
  assert.equal(aiName(), 'Claude');
});

test('Ollama is asked in its own way: room to read, and no thinking unless wanted', async () => {
  const s = await fake((p, body) => {
    if (p === '/api/version') return [200, { version: '0.40.0' }];
    if (p === '/v1/models') return [200, { data: [{ id: 'qwen3:8b' }, { id: 'nomic-embed-text' }] }];
    if (p === '/api/chat') {
      if (body.tools && !body.messages.some((m) => m.role === 'tool')) return [200, { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'get_accounts', arguments: {} } }] }, prompt_eval_count: 50, eval_count: 5 }];
      return [200, { message: { role: 'assistant', content: '<think>hmm</think>You have $5.' }, done_reason: 'stop', prompt_eval_count: 80, eval_count: 9 }];
    }
    return [404, {}];
  });
  try {
    assert.deepEqual(await localModels(s.url), ['qwen3:8b']);   // the embedding model can't answer questions
    use(s.url, 'qwen3:8b');
    assert.equal(await serverKind(s.url), 'ollama');
    assert.equal(viaLocal(), true);
    assert.equal(plainRoute(), 'local');
    assert.equal(aiName(), 'your AI');

    assert.equal(await localAsk('a test', 'Say something.', 'check', 'a test'), 'You have $5.');
    const plain = s.seen.at(-1);
    assert.equal(plain.path, '/api/chat');
    assert.equal(plain.body.think, false);
    assert.equal(plain.body.options.num_ctx, 16384);

    // A tool call comes back for the caller to run, and its answer is sent on in Ollama's form.
    const tools = [{ type: 'function', function: { name: 'get_accounts', description: 'x', parameters: { type: 'object', properties: {} } } }];
    const messages = [{ role: 'user', content: 'How much do I have?' }];
    const first = await localChat(messages, { tools, think: true });
    assert.deepEqual(first.calls.map((c) => [c.name, c.input]), [['get_accounts', {}]]);
    assert.equal(s.seen.at(-1).body.think, true);
    messages.push(first.message, { role: 'tool', tool_call_id: first.calls[0].id, name: 'get_accounts', content: '{"balance":5}' });
    const second = await localChat(messages, { tools, think: true });
    assert.equal(second.text, 'You have $5.');
    const sent = s.seen.at(-1).body.messages;
    assert.deepEqual(sent[1].tool_calls[0].function, { name: 'get_accounts', arguments: {} });
    assert.deepEqual(sent[2], { role: 'tool', content: '{"balance":5}', tool_name: 'get_accounts' });

    // What went is written down in plain words, at no cost, and never the content itself.
    const log = db.prepare("SELECT feature, model, source, cost, sent, input_tokens FROM ai_usage WHERE source = 'local' ORDER BY id").all();
    assert.deepEqual({ ...log[0] }, { feature: 'check', model: 'local:qwen3:8b', source: 'local', cost: 0, sent: 'a test', input_tokens: 80 });
  } finally { await s.close(); }
});

test('any other server is asked in the common form, and one that refuses "no thinking" is asked again without', async () => {
  const s = await fake((p, body) => {
    if (p === '/v1/models') return [200, { data: [{ id: 'local-model' }] }];
    if (p === '/v1/chat/completions') {
      if (body.reasoning_effort) return [400, { error: 'unknown field' }];
      return [200, { choices: [{ message: { role: 'assistant', content: 'Here you go: {"ok": true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 6 } }];
    }
    return [404, {}];
  });
  try {
    use(s.url, 'local-model');
    assert.equal(await serverKind(s.url), 'openai');
    assert.deepEqual(await localAskJson('a test', 'Give JSON.', 'check'), { ok: true });
    assert.deepEqual(s.seen.filter((r) => r.path === '/v1/chat/completions').map((r) => !!r.body.reasoning_effort), [true, false]);
  } finally { await s.close(); }
});

test('a model without tool calls says so in a way the CFO can fall back from', async () => {
  const s = await fake((p, body) => (p === '/v1/chat/completions' ? (body.tools ? [400, { error: 'does not support tools' }] : [200, { choices: [{ message: { content: 'ok' } }] }]) : [404, {}]));
  try {
    use(s.url, 'tiny');
    await assert.rejects(localChat([{ role: 'user', content: 'x' }], { tools: [{ type: 'function', function: { name: 'a', parameters: {} } }], think: true }), (e) => e.noTools === true);
  } finally { await s.close(); }
});

test('a server that is not there is explained, not thrown as a network error', async () => {
  use('http://127.0.0.1:9', 'x');
  await assert.rejects(localAsk('a test', 'x', 'check'), /couldn't reach a model server/);
  await assert.rejects(localModels('http://127.0.0.1:9'), /couldn't reach a model server/);
});

test('a backup is a whole database that opens on its own, and old ones are cleared away', () => {
  setSetting('backup_marker', 'kept');
  setSetting('backup_keep', '2');
  for (const day of [1, 2, 3]) backup.nightly(new Date(2026, 0, day));
  const copies = backup.list();
  assert.equal(copies.length, 2);
  assert.ok(copies.every((c) => /^ledger-2026-01-0[123]\.db$/.test(c.name)));
  const copy = new DatabaseSync(path.join(process.env.LEDGER_DATA_DIR, 'backups', copies[0].name), { readOnly: true });
  assert.equal(copy.prepare("SELECT value FROM settings WHERE key = 'backup_marker'").get().value, 'kept');
  copy.close();
  setSetting('backup_keep', '0');
  assert.equal(backup.nightly(new Date(2026, 0, 4)), null);
  assert.ok(Number(getSetting('backup_last')) > 0);
});
