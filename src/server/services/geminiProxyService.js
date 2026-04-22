import { env } from '../lib/env.js';
import { AppError } from '../lib/errors.js';
import { ensureGeminiCache, invalidateGeminiCache } from './geminiCacheService.js';

function extractJSON(buffer) {
  const results = [];
  let braceCount = 0;
  let inString = false;
  let escaped = false;
  let startIndex = -1;
  let lastIndex = 0;

  for (let i = 0; i < buffer.length; i += 1) {
    const char = buffer[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (braceCount === 0) startIndex = i;
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
      if (braceCount === 0 && startIndex !== -1) {
        results.push(buffer.substring(startIndex, i + 1));
        startIndex = -1;
        lastIndex = i + 1;
      }
    }
  }

  return { results, remaining: buffer.substring(lastIndex) };
}

async function sendGeminiRequest({ body, stream }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.GEMINI_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:${stream ? 'streamGenerateContent' : 'generateContent'}?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('Gemini request timed out', 504, 'GEMINI_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildRequestPayload({ messages, temperature, maxOutputTokens, mode, cachedContent }) {
  return {
    contents: messages.contents,
    generationConfig: {
      temperature: temperature || 0.4,
      maxOutputTokens: maxOutputTokens || 8000,
      thinkingConfig: { thinkingLevel: mode === 'think' ? 'high' : 'low' },
    },
    ...(cachedContent
      ? { cachedContent }
      : { systemInstruction: messages.systemInstruction }),
  };
}

export async function proxyGeminiRequest(req, res) {
  if (!env.GEMINI_API_KEY) {
    throw new AppError('Missing GEMINI_API_KEY', 500, 'MISSING_GEMINI_API_KEY');
  }

  const { messages, stream, temperature, mode, maxOutputTokens } = req.body || {};
  const systemPrompt = messages?.systemInstruction?.parts?.[0]?.text || '';
  const { cache, action } = await ensureGeminiCache(systemPrompt);

  let cacheAction = action;
  let response = await sendGeminiRequest({
    body: buildRequestPayload({ messages, temperature, maxOutputTokens, mode, cachedContent: cache?.id || null }),
    stream,
  });

  if (cache?.id && (response.status === 403 || response.status === 404)) {
    await invalidateGeminiCache();
    cacheAction = 'failed';
    response = await sendGeminiRequest({
      body: buildRequestPayload({ messages, temperature, maxOutputTokens, mode }),
      stream,
    });
  }

  res.setHeader('X-Cache-Action', cacheAction);
  res.setHeader('X-Cache-Model', env.GEMINI_MODEL);
  res.setHeader('X-Cache-Thinking', mode === 'think' ? 'high' : 'low');
  res.setHeader('Access-Control-Expose-Headers', 'X-Cache-Action, X-Cache-Model, X-Cache-Thinking');

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(text || 'Gemini request failed', response.status, 'GEMINI_UPSTREAM_ERROR');
  }

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let buffer = '';
    const decoder = new TextDecoder();

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const { results, remaining } = extractJSON(buffer);
      buffer = remaining;
      for (const jsonStr of results) {
        try {
          res.write(`data: ${JSON.stringify(JSON.parse(jsonStr))}\n\n`);
        } catch {
          continue;
        }
      }
    }

    const { results: tailResults } = extractJSON(buffer);
    for (const jsonStr of tailResults) {
      try {
        res.write(`data: ${JSON.stringify(JSON.parse(jsonStr))}\n\n`);
      } catch {
        continue;
      }
    }

    res.end();
    return;
  }

  const data = await response.json();
  res.json(data);
}
