import { AppError } from './errors.js';

export async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      throw new AppError(
        typeof data === 'string' ? data : data?.error?.message || data?.message || 'Upstream request failed',
        response.status,
        response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_ERROR',
        typeof data === 'object' ? data : { raw: data }
      );
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AppError('Upstream request timed out', 504, 'UPSTREAM_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
