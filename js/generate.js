// Step 6: chunk -> instruction/input/output pairs via the Gemini API.
// No DOM access. Swap providers later by changing only this file.

import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESPONSE_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      task_type: { type: 'STRING' },
      instruction: { type: 'STRING' },
      input: { type: 'STRING' },
      output: { type: 'STRING' },
    },
    required: ['task_type', 'instruction', 'input', 'output'],
  },
};

async function errorMessage(res) {
  try {
    const j = await res.json();
    return j?.error?.message || JSON.stringify(j);
  } catch {
    return res.statusText;
  }
}

// fetch with a timeout
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// POST with retry on 429 / 5xx / timeout (exponential backoff). Reports each retry via cfg.onStatus.
async function postWithRetry(url, apiKey, body, cfg) {
  const say = (m) => cfg.onStatus && cfg.onStatus(m);
  const timeoutMs = cfg.requestTimeoutMs || 60000;
  let lastErr;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    let retryable = false;
    let reason = '';
    const started = Date.now();

    try {
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
        },
        timeoutMs
      );
      if (res.ok) return res.json();

      const msg = await errorMessage(res);
      lastErr = new Error(`API ${res.status}: ${msg}`);
      retryable = res.status === 429 || res.status >= 500;
      reason = res.status === 429 ? 'rate limited (429)' : `server error (${res.status})`;
    } catch (err) {
      if (err.name === 'AbortError') {
        lastErr = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        reason = 'timed out';
      } else {
        lastErr = new Error(`Network error: ${err.message}`);
        reason = 'network error';
      }
      retryable = true;
    }

    if (!retryable || attempt === cfg.maxRetries) throw lastErr;

    const wait = cfg.retryBaseDelayMs * 2 ** attempt;
    say(`${reason} after ${Math.round((Date.now() - started) / 1000)}s. Waiting ${Math.round(wait / 1000)}s, then retry ${attempt + 1}/${cfg.maxRetries}`);
    await sleep(wait);
  }
  throw lastErr;
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const a = cleaned.indexOf('[');
    const b = cleaned.lastIndexOf(']');
    if (a !== -1 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
    throw new Error('Model did not return valid JSON');
  }
}

export async function listModels(apiKey) {
  if (!apiKey) throw new Error('Paste your API key first.');
  const res = await fetch(`${API_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  if (!res.ok) throw new Error(`API ${res.status}: ${await errorMessage(res)}`);
  const j = await res.json();
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

export async function generatePairs(chunk, apiKey, cfg) {
  if (!apiKey) throw new Error('Paste your API key first.');

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(chunk, cfg.pairsPerChunk) }] }],
    generationConfig: {
      temperature: cfg.temperature,
      maxOutputTokens: cfg.maxOutputTokens,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const data = await postWithRetry(`${API_BASE}/models/${cfg.model}:generateContent`, apiKey, body, cfg);

  const cand = data.candidates && data.candidates[0];
  if (!cand) {
    throw new Error('No response candidates' + (data.promptFeedback ? ': ' + JSON.stringify(data.promptFeedback) : ''));
  }
  const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  if (!text) throw new Error(`Empty response (finishReason: ${cand.finishReason})`);

  const parsed = parseJsonLoose(text);
  if (!Array.isArray(parsed)) throw new Error('Model returned JSON, but not an array');

  const pairs = parsed.map((p) => ({
    task_type: p.task_type,
    instruction: p.instruction,
    input: p.input,
    output: p.output,
    meta: {
      paperId: chunk.paperId,
      chunkId: chunk.id,
      section: chunk.sectionPath,
      model: cfg.model,
      promptVersion: PROMPT_VERSION,
      schemaVersion: cfg.schemaVersion,
    },
  }));

  return { pairs, finishReason: cand.finishReason, usage: data.usageMetadata || null };
}
