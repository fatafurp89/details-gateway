import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, validateAiKey, maskKey, canDelete, checkRequest, classifyCheck, validateComplete, completionRequest, normalizeCompletion, publicKey,
  ANTHROPIC_VERSION } from '../src/lib/ai.js';

const KEY = 'sk-abcdef0123456789secretXYZ9';

test('provider check: enum enforced, label/base/model rules, key pasted once', () => {
  assert.ok(validateAiKey({ provider: 'bard', label: 'x', key: KEY }).error);
  assert.ok(validateAiKey({ provider: 'deepseek', label: 'x', key: KEY }).error); // label too short
  assert.ok(validateAiKey({ provider: 'deepseek', label: 'رئيسي', key: 'short' }).error);
  assert.ok(validateAiKey({ provider: 'deepseek', label: 'رئيسي', key: 'has space inside key' }).error);
  assert.ok(validateAiKey({ provider: 'other', label: 'محلي', key: KEY }).error); // other needs base_url
  assert.ok(validateAiKey({ provider: 'other', label: 'محلي', key: KEY, base_url: 'http://x' }).error);
  assert.ok(validateAiKey({ provider: 'openai', label: 'x1', key: KEY, default_model: 'bad model!' }).error);
  const v = validateAiKey({ provider: 'DeepSeek', label: ' DeepSeek — المفتاح الرئيسي ', key: ` ${KEY} `, base_url: 'https://api.deepseek.com/' });
  assert.equal(v.error, undefined);
  assert.equal(v.value.provider, 'deepseek');
  assert.equal(v.value.base_url, 'https://api.deepseek.com');
  assert.equal(v.key, KEY);
  assert.equal(v.value.key, undefined); // the secret is never part of the stored "value"
  const u = validateAiKey({ provider: 'deepseek', label: 'تعديل' }, { isNew: false });
  assert.equal(u.error, undefined);
  assert.equal(u.key, null);
});

test('masking: first 6 + last 4 only; short keys never fully revealed', () => {
  assert.deepEqual(maskKey(KEY), { prefix: 'sk-abc', last4: 'XYZ9' });
  assert.deepEqual(maskKey('abcdefgh'), { prefix: 'ab', last4: 'gh' });
  const p = publicKey({ id: '1', provider: 'deepseek', label: 'l', key_prefix: 'sk-abc', key_last4: 'XYZ9', status: 'valid', usage_count: '3', secret_enc: Buffer.from('x'), secret_iv: Buffer.from('y') });
  assert.equal(p.key_display, 'sk-abc…XYZ9');
  assert.equal(p.secret_enc, undefined);
  assert.equal(p.secret_iv, undefined);
  assert.equal(p.usage_count, 3);
  assert.equal(p.effective_model, PROVIDERS.deepseek.model);
  assert.equal(p.deletable, false);
});

test('delete rule: only invalid or disconnected keys', () => {
  assert.equal(canDelete('valid'), false);
  assert.equal(canDelete('unknown'), false);
  assert.equal(canDelete('invalid'), true);
  assert.equal(canDelete('disconnected'), true);
});

test('connection check uses the cheapest endpoint per provider; key only in headers', () => {
  const d = checkRequest('deepseek', null, KEY);
  assert.equal(d.url, 'https://api.deepseek.com/models');
  assert.equal(d.headers.Authorization, `Bearer ${KEY}`);
  const o = checkRequest('other', 'https://llm.local/v1', KEY);
  assert.equal(o.url, 'https://llm.local/v1/models');
  const a = checkRequest('anthropic', null, KEY);
  assert.ok(a.url.startsWith('https://api.anthropic.com/v1/models'));
  assert.equal(a.headers['x-api-key'], KEY);
  assert.equal(a.headers['anthropic-version'], ANTHROPIC_VERSION);
  const g = checkRequest('google', null, KEY);
  assert.ok(g.url.startsWith('https://generativelanguage.googleapis.com/v1beta/models'));
  assert.equal(g.headers['x-goog-api-key'], KEY);
  assert.ok(!g.url.includes(KEY));
});

test('classifyCheck: 2xx valid, 401/403 invalid, 5xx/network disconnected, key scrubbed from errors', () => {
  assert.equal(classifyCheck({ status: 200 }).status, 'valid');
  assert.equal(classifyCheck({ status: 429 }).status, 'valid');
  assert.equal(classifyCheck({ status: 401 }).status, 'invalid');
  assert.equal(classifyCheck({ status: 403 }).status, 'invalid');
  assert.equal(classifyCheck({ status: 404, text: `not found ${KEY}` }, KEY).status, 'invalid');
  assert.ok(!classifyCheck({ status: 404, text: `not found ${KEY}` }, KEY).last_error.includes(KEY));
  assert.equal(classifyCheck({ status: 503 }).status, 'disconnected');
  assert.equal(classifyCheck({ status: 0, error: 'timeout' }).status, 'disconnected');
});

test('validateComplete: provider or key_id, messages shape, limits', () => {
  assert.ok(validateComplete({}).error);
  assert.ok(validateComplete({ provider: 'deepseek' }).error);
  assert.ok(validateComplete({ provider: 'deepseek', messages: [{ role: 'tool', content: 'x' }] }).error);
  assert.ok(validateComplete({ provider: 'deepseek', messages: [{ role: 'system', content: 'x' }] }).error);
  assert.ok(validateComplete({ key_id: 'nope', messages: [{ role: 'user', content: 'x' }] }).error);
  assert.ok(validateComplete({ provider: 'deepseek', messages: [{ role: 'user', content: 'x' }], max_tokens: 0 }).error);
  const v = validateComplete({ provider: 'DeepSeek', model: 'deepseek-chat', messages: [{ role: 'system', content: 'كن مختصرًا' }, { role: 'user', content: [{ type: 'text', text: 'مرحبا' }] }], max_tokens: 50, temperature: 0.2, system: 'hr' }).value;
  assert.equal(v.provider, 'deepseek');
  assert.equal(v.messages[1].content, 'مرحبا');
  assert.equal(v.max_tokens, 50);
  assert.equal(v.system, 'hr');
});

test('completion request: OpenAI-compatible passthrough, Anthropic and Google translation', () => {
  const msgs = [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }, { role: 'assistant', content: 'A' }, { role: 'user', content: 'U2' }];
  const d = completionRequest('deepseek', null, KEY, { model: 'deepseek-chat', messages: msgs, max_tokens: 10, temperature: 0 });
  assert.equal(d.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(d.body.messages.length, 4);
  assert.equal(d.body.max_tokens, 10);
  assert.equal(d.body.temperature, 0);
  const a = completionRequest('anthropic', null, KEY, { model: 'claude-sonnet-4-5', messages: msgs, max_tokens: null, temperature: null });
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(a.body.system, 'S');
  assert.equal(a.body.messages.length, 3);
  assert.equal(a.body.max_tokens, 1024);
  assert.equal(a.body.temperature, undefined);
  const g = completionRequest('google', null, KEY, { model: 'gemini-2.0-flash', messages: msgs, max_tokens: 20, temperature: 0.5 });
  assert.equal(g.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(g.body.systemInstruction.parts[0].text, 'S');
  assert.deepEqual(g.body.contents.map((c) => c.role), ['user', 'model', 'user']);
  assert.equal(g.body.generationConfig.maxOutputTokens, 20);
  assert.ok(!g.url.includes(KEY));
  const r = completionRequest('openrouter', null, KEY, { model: 'x/y', messages: msgs });
  assert.equal(r.headers['X-Title'], 'Details Gateway');
});

test('normalizeCompletion returns the OpenAI shape for every provider', () => {
  const o = normalizeCompletion('deepseek', { id: 'c1', model: 'deepseek-chat', choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }, 'deepseek-chat');
  assert.equal(o.choices[0].message.content, 'hi');
  assert.equal(o.usage.total_tokens, 5);
  const a = normalizeCompletion('anthropic', { id: 'm1', model: 'claude', content: [{ type: 'text', text: 'he' }, { type: 'text', text: 'llo' }], stop_reason: 'end_turn', usage: { input_tokens: 4, output_tokens: 6 } }, 'claude');
  assert.equal(a.choices[0].message.content, 'hello');
  assert.equal(a.usage.total_tokens, 10);
  assert.equal(a.choices[0].finish_reason, 'end_turn');
  const g = normalizeCompletion('google', { candidates: [{ content: { parts: [{ text: 'سلام' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 } }, 'gemini');
  assert.equal(g.choices[0].message.content, 'سلام');
  assert.equal(g.usage.total_tokens, 3);
  assert.equal(normalizeCompletion('openai', {}, 'm').choices.length, 0);
});
