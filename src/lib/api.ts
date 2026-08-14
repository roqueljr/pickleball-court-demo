export class ApiError extends Error {
  constructor(public status: number, message: string, public errors: Record<string, unknown> = {}) { super(message); }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) }
    });
  } catch {
    throw new ApiError(503, "Unable to connect to the API server. Start it with: npm run dev", {});
  }
  const payload = await response.json().catch(() => ({ success: false, message: "The server returned an invalid response." }));
  if (!response.ok || !payload.success) throw new ApiError(response.status, payload.message ?? "Request failed.", payload.errors ?? {});
  return payload.data as T;
}
