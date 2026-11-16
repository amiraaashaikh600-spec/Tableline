export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function api(path, options = {}) {
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = { ...(!isForm ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
  let response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' });
  } catch {
    throw new ApiError('Tableline could not reach the server. Check your connection and try again.', 0);
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data?.message || 'Something went wrong. Please try again.', response.status);
  return data;
}

export const jsonBody = value => JSON.stringify(value);
