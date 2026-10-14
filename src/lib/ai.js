// «مفاتيح الذكاء الاصطناعي» (pure + fetch): provider adapters, validation, masking, delete rule, request builders, response normalization.
// The secret key is only ever placed in request headers; it never appears in URLs, logs, errors or API responses.
export const PROVIDERS = {
  deepseek:   { name: 'DeepSeek',   base: 'https://api.deepseek.com',                         model: 'deepseek-chat',      style: 'openai' },
  openai:     { name: 'OpenAI',     base: 'https://api.openai.com/v1',                        model: 'gpt-4o-mini',        style: 'openai' },
  anthropic:  { name: 'Anthropic',  base: 'https://api.anthropic.com',                        model: 'claude-sonnet-4-5',  style: 'anthropic' },
  google:     { name: 'Google',     base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash',   style: 'google' },
  openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1',                     model: 'openai/gpt-4o-mini', style: 'openai' },
  other:      { name: 'أخرى (متوافق مع OpenAI)', base: '',                                     model: '',                   style: 'openai' },
};
export const PROVIDER_KEYS = Object.keys(PROVIDERS);
export const STATUSES = ['valid', 'invalid', 'disconnected', 'unknown'];
export const DELETABLE = ['invalid', 'disconnected'];
export const MSG_AI = {
  noDelete: 'لا يمكن حذف مفتاح صالح متصل',
  noKey: 'لا يوجد مفتاح متاح لهذا المزود',
  timeout: 'انتهت مهلة الاتصال بالمزود (30 ثانية)',
};
export const TIMEOUT_MS = 30_000;
export const CHECK_TIMEOUT_MS = 15_000;
export const ANTHROPIC_VERSION = '2023-06-01';
const UUID_RE = /^[0-9a-f-]{36}$/;
const MODEL_RE = /^[a-z0-9][a-z0-9._:\/-]{0,120}$/i;
const str = (v, max) => (v === undefined || v === null ? '' : String(v).trim()).slice(0, max);
const strip = (u) => String(u || '').replace(/\/+$/, '');

export const baseFor = (provider, baseUrl) => strip(baseUrl) || PROVIDERS[provider]?.base || '';
export const modelFor = (provider, model, stored) => str(model, 120) || str(stored, 120) || PROVIDERS[provider]?.model || '';

/** First 6 chars + last 4 for display; shorter keys are still masked (never the whole key). */
export function maskKey(key) {
  const k = String(key ?? '');
  if (k.length <= 10) return { prefix: k.slice(0, 2), last4: k.slice(-2) };
  return { prefix: k.slice(0, 6), last4: k.slice(-4) };
}
export const displayKey = (prefix, last4) => `${prefix}…${last4}`;

/** Server rule: a key may be deleted only when its last check said invalid or disconnected. */
export const canDelete = (status) => DELETABLE.includes(status);

/** Validate the add/update form. isNew requires the key. Returns { value, key } or { error }. */
export function validateAiKey(input, { isNew = true } = {}) {
  if (!input || typeof input !== 'object') return { error: 'الطلب غير صالح' };
  const provider = str(input.provider, 20).toLowerCase();
  if (!PROVIDER_KEYS.includes(provider)) return { error: 'المزود غير معروف' };
  const label = str(input.label, 120);
  if (label.length < 2) return { error: 'اسم المفتاح مطلوب (حرفان على الأقل)' };
  const base_url = strip(str(input.base_url, 500)) || null;
  if (base_url && !/^https:\/\/[^\s\/]+(\/[^\s]*)?$/.test(base_url)) return { error: 'الرابط الأساسي يجب أن يبدأ بـ https://' };
  if (provider === 'other' && !base_url) return { error: 'المزود «أخرى» يتطلب الرابط الأساسي (base URL)' };
  const default_model = str(input.default_model, 120) || null;
  if (default_model && !MODEL_RE.test(default_model)) return { error: 'اسم النموذج غير صالح' };
  const key = typeof input.key === 'string' ? input.key.trim() : '';
  if (isNew || key) {
    if (!key) return { error: 'المفتاح مطلوب' };
    if (key.length < 8 || key.length > 4000) return { error: 'طول المفتاح غير معقول' };
    if (/\s/.test(key)) return { error: 'المفتاح لا يحتوي مسافات أو أسطرًا' };
  }
  return { value: { provider, label, base_url, default_model }, key: key || null };
}

/** The provider's cheapest authenticated endpoint. The key goes in a header only (Google too: x-goog-api-key, not ?key=). */
export function checkRequest(provider, baseUrl, key) {
  const base = baseFor(provider, baseUrl);
  const style = PROVIDERS[provider]?.style || 'openai';
  if (style === 'anthropic') return { url: `${base}/v1/models?limit=1`, headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION } };
  if (style === 'google') return { url: `${base}/models?pageSize=1`, headers: { 'x-goog-api-key': key } };
  return { url: `${base}/models`, headers: { Authorization: `Bearer ${key}` } };
}

/** HTTP outcome → stored status + Arabic error (never containing the key). */
export function classifyCheck({ status, error, text }, key = '') {
  const scrub = (s) => (key ? String(s || '').split(key).join('***') : String(s || '')).slice(0, 300);
  if (error) return { status: 'disconnected', last_error: scrub(error) };
  if (status >= 200 && status < 300) return { status: 'valid', last_error: null };
  if (status === 429) return { status: 'valid', last_error: 'المفتاح مقبول لكن المزود يحدّ الطلبات الآن (429)' };
  if (status === 401 || status === 403) return { status: 'invalid', last_error: `المزود رفض المفتاح (${status})` };
  if (status >= 500) return { status: 'disconnected', last_error: `خطأ في خادم المزود (${status})` };
  return { status: 'invalid', last_error: `رد غير متوقع من المزود (${status}) ${scrub(text)}`.trim() };
}

/** Validate POST /_gw/ai/complete body. */
export function validateComplete(body) {
  if (!body || typeof body !== 'object') return { error: 'الطلب غير صالح' };
  const provider = str(body.provider, 20).toLowerCase() || null;
  if (provider && !PROVIDER_KEYS.includes(provider)) return { error: 'المزود غير معروف' };
  const key_id = str(body.key_id, 40) || null;
  if (key_id && !UUID_RE.test(key_id)) return { error: 'معرّف المفتاح غير صالح' };
  if (!provider && !key_id) return { error: 'حدد provider أو key_id' };
  const model = str(body.model, 120) || null;
  if (model && !MODEL_RE.test(model)) return { error: 'اسم النموذج غير صالح' };
  if (!Array.isArray(body.messages) || !body.messages.length) return { error: 'messages مطلوبة' };
  if (body.messages.length > 200) return { error: 'عدد الرسائل كبير جدًا' };
  const messages = [];
  let size = 0;
  for (const m of body.messages) {
    const role = str(m?.role, 12).toLowerCase();
    if (!['system', 'user', 'assistant'].includes(role)) return { error: 'دور الرسالة يجب أن يكون system أو user أو assistant' };
    const content = typeof m?.content === 'string' ? m.content : (Array.isArray(m?.content) ? m.content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n') : '');
    if (!content.trim()) return { error: 'محتوى الرسالة فارغ' };
    size += content.length;
    messages.push({ role, content });
  }
  if (size > 400_000) return { error: 'حجم الرسائل يتجاوز الحد' };
  if (messages.every((m) => m.role === 'system')) return { error: 'يلزم رسالة user واحدة على الأقل' };
  const max_tokens = body.max_tokens === undefined ? null : Math.trunc(Number(body.max_tokens));
  if (max_tokens !== null && !(max_tokens >= 1 && max_tokens <= 32_000)) return { error: 'max_tokens بين 1 و32000' };
  const temperature = body.temperature === undefined ? null : Number(body.temperature);
  if (temperature !== null && !(temperature >= 0 && temperature <= 2)) return { error: 'temperature بين 0 و2' };
  const system = str(body.system, 40) || null;
  return { value: { provider, key_id, model, messages, max_tokens, temperature, system } };
}

/** Build the provider request for a chat completion. */
export function completionRequest(provider, baseUrl, key, { model, messages, max_tokens, temperature }) {
  const base = baseFor(provider, baseUrl);
  const style = PROVIDERS[provider]?.style || 'openai';
  if (style === 'anthropic') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const body = { model, max_tokens: max_tokens || 1024, messages: rest };
    if (system) body.system = system;
    if (temperature !== null && temperature !== undefined) body.temperature = temperature;
    return { url: `${base}/v1/messages`, headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' }, body };
  }
  if (style === 'google') {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents, generationConfig: {} };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    if (max_tokens) body.generationConfig.maxOutputTokens = max_tokens;
    if (temperature !== null && temperature !== undefined) body.generationConfig.temperature = temperature;
    return { url: `${base}/models/${encodeURIComponent(model)}:generateContent`, headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, body };
  }
  const body = { model, messages: messages.map((m) => ({ role: m.role, content: m.content })) };
  if (max_tokens) body.max_tokens = max_tokens;
  if (temperature !== null && temperature !== undefined) body.temperature = temperature;
  const headers = { Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://details-wms.cloud'; headers['X-Title'] = 'Details Gateway'; }
  return { url: `${base}/chat/completions`, headers, body };
}

/** Provider JSON → OpenAI-compatible { id, model, choices[{index, message{role,content}, finish_reason}], usage{prompt_tokens, completion_tokens, total_tokens} }. */
export function normalizeCompletion(provider, json, model) {
  const style = PROVIDERS[provider]?.style || 'openai';
  if (style === 'anthropic') {
    const text = (json?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const u = json?.usage || {};
    const usage = { prompt_tokens: u.input_tokens ?? null, completion_tokens: u.output_tokens ?? null };
    usage.total_tokens = usage.prompt_tokens != null && usage.completion_tokens != null ? usage.prompt_tokens + usage.completion_tokens : null;
    return { id: json?.id || null, model: json?.model || model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: json?.stop_reason || null }], usage };
  }
  if (style === 'google') {
    const c = json?.candidates?.[0];
    const text = (c?.content?.parts || []).map((p) => p.text || '').join('');
    const u = json?.usageMetadata || {};
    return { id: json?.responseId || null, model: json?.modelVersion || model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: c?.finishReason || null }],
      usage: { prompt_tokens: u.promptTokenCount ?? null, completion_tokens: u.candidatesTokenCount ?? null, total_tokens: u.totalTokenCount ?? null } };
  }
  const u = json?.usage || {};
  return { id: json?.id || null, model: json?.model || model,
    choices: (json?.choices || []).map((ch, i) => ({ index: ch.index ?? i, message: { role: ch.message?.role || 'assistant', content: ch.message?.content ?? '' }, finish_reason: ch.finish_reason ?? null })),
    usage: { prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null } };
}

/** Public shape of an ai_keys row: never the secret. */
export function publicKey(r) {
  return {
    id: r.id, provider: r.provider, provider_name: PROVIDERS[r.provider]?.name || r.provider, label: r.label,
    key_prefix: r.key_prefix, key_last4: r.key_last4, key_display: displayKey(r.key_prefix, r.key_last4),
    base_url: r.base_url || null, effective_base_url: baseFor(r.provider, r.base_url), default_model: r.default_model || null,
    effective_model: modelFor(r.provider, null, r.default_model) || null,
    created_by: r.created_by || null, created_by_name: r.created_by_name || null, created_at: r.created_at,
    last_checked_at: r.last_checked_at || null, status: r.status, last_error: r.last_error || null,
    usage_count: Number(r.usage_count || 0), last_used_at: r.last_used_at || null, deletable: canDelete(r.status),
  };
}

/** fetch with timeout; returns { status, json, text, ms, error } and never throws. */
export async function fetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal, redirect: 'manual' });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text: text.slice(0, 2000), ms: Date.now() - t0, error: null };
  } catch (e) {
    const timeout = e?.name === 'AbortError';
    return { status: 0, json: null, text: '', ms: Date.now() - t0, error: timeout ? MSG_AI.timeout : `تعذر الاتصال بالمزود: ${(e?.cause?.code || e?.code || e?.message || 'network').toString().slice(0, 80)}` };
  } finally { clearTimeout(t); }
}
