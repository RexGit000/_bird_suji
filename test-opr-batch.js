import dotenv from 'dotenv';

dotenv.config();

function getOpenRouterApiKeys() {
  const keys = [];
  const k1 = process.env.OPENROUTER_API_KEY_1 || process.env.OPENROUTER_API_KEY || '';
  const k2 = process.env.OPENROUTER_API_KEY_2 || '';
  if (k1 && k1.trim()) keys.push(k1.trim());
  if (k2 && k2.trim() && k2.trim() !== k1.trim()) keys.push(k2.trim());
  return keys;
}

function clampTimeoutMs(value) {
  const n = Number(value);
  const v = Number.isFinite(n) ? n : 3_000_000;
  return Math.max(6000, Math.min(3_600_000, v));
}

function extractJsonArray(raw) {
  if (!raw) return null;
  const s = raw.toString();
  const i = s.indexOf('[');
  const j = s.lastIndexOf(']');
  if (i === -1 || j === -1 || j <= i) return null;
  const slice = s.slice(i, j + 1);
  try {
    const parsed = JSON.parse(slice);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function callOpenRouterBatch({ prompt, model, timeoutMs, apiKey }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bodyText: text, headers: Object.fromEntries(res.headers.entries()) };
  } finally {
    clearTimeout(t);
  }
}

function buildPrompt(items) {
  return (
    `You are a hiring-intent classifier for developer chat groups.\n` +
    `You will classify a batch of messages.\n\n` +
    `Return ONLY valid JSON: an array of objects like {"id":"...","keep":true|false}.\n` +
    `keep=true only if the message is asking to hire/recruit/find a developer/engineer for work (full-time, freelance, gig, contract, project, one-time task).\n` +
    `Do NOT include any text outside the JSON array.\n\n` +
    `Batch items (JSON):\n` +
    `${JSON.stringify(items)}\n`
  );
}

async function main() {
  const keys = getOpenRouterApiKeys();
  if (!keys.length) {
    console.error('Missing OPENROUTER_API_KEY_1 (or OPENROUTER_API_KEY).');
    process.exitCode = 2;
    return;
  }

  const model = 'openrouter/free';
  const timeoutMs = clampTimeoutMs(process.env.OPENROUTER_TIMEOUT_MS || 3_000_000);

  const dummy = [
    'Hiring: need a React dev for a landing page. Budget $500. DM with portfolio.',
    'Looking for a backend engineer (Node.js + MongoDB) to build an API. Paid. Remote.',
    'Need someone to fix a bug in my Flutter app today. Paid task.',
    'Anybody here knows how to center a div?',
    'I am a fullstack developer available for work. Here is my portfolio.',
    'We are recruiting a DevOps engineer. AWS, Terraform. Apply with CV.',
    'For sale: MacBook Pro 16" 2021.',
    'Need Unity3D developer to build an open world game. Budget negotiable.',
    'Daily motivation: keep pushing.',
    'Looking for a UI/UX designer and a web developer for a small project.',
  ];

  const items = dummy.map((text, i) => ({ id: `d${i + 1}`, text }));
  const prompt = buildPrompt(items);

  console.log(
    JSON.stringify(
      {
        provider: 'openrouter',
        model,
        timeoutMs,
        items: items.map(x => ({ id: x.id, textPreview: x.text.slice(0, 120) })),
      },
      null,
      2
    )
  );

  let last = null;
  for (let idx = 0; idx < keys.length; idx++) {
    const apiKey = keys[idx];
    console.log(`\nAttempt keyIndex=${idx}`);
    try {
      last = await callOpenRouterBatch({ prompt, model, timeoutMs, apiKey });
      console.log(`HTTP ${last.status}`);
      if (!last.ok) {
        console.log(last.bodyText.slice(0, 6000));
        continue;
      }
      let content = null;
      try {
        const json = JSON.parse(last.bodyText);
        content = json?.choices?.[0]?.message?.content ?? null;
      } catch {}
      const raw = content ?? last.bodyText;
      const parsed = extractJsonArray(raw) || extractJsonArray(last.bodyText);
      console.log('\nRaw output (truncated):\n' + raw.toString().slice(0, 6000));
      if (!parsed) {
        console.log('\nParse: failed (no JSON array found)');
        process.exitCode = 1;
        return;
      }
      const rows = parsed
        .map(r => ({ id: r?.id?.toString?.() || null, keep: !!r?.keep }))
        .filter(r => r.id);
      console.log('\nParsed decisions:\n' + JSON.stringify(rows, null, 2));
      const kept = rows.filter(r => r.keep).map(r => r.id);
      console.log(`\nKept: ${kept.length}/${items.length} (${kept.join(', ') || 'none'})`);
      process.exitCode = 0;
      return;
    } catch (err) {
      console.log(`Error: ${(err?.message || 'error').toString()}`);
      last = { ok: false, status: null, bodyText: '', error: err };
    }
  }

  console.error('\nAll keys failed.');
  if (last?.bodyText) console.error(last.bodyText.slice(0, 6000));
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.stack || err?.message || 'fatal');
  process.exitCode = 1;
});
