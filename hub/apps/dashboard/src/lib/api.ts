/**
 * Thin fetch wrapper for the hub API.
 *
 * Same-origin by default (prod: Caddy proxies /api to the api service;
 * "npm run dev": vite.config.ts proxies it) - VITE_API_URL is left unset
 * and paths resolve relative to the dashboard's own origin.
 *
 * Cross-origin only in the Docker dev harness (dev/docker-compose.yml),
 * where the dashboard's nginx container and the api container are on
 * different ports with no reverse proxy between them; that compose file
 * bakes VITE_API_URL in as a build arg. Cookies still travel - see
 * ALLOWED_ORIGINS + credentials: "include" below.
 */

const RAW_API_BASE = import.meta.env.VITE_API_URL ?? "";
const API_BASE = RAW_API_BASE.endsWith("/") ? RAW_API_BASE.slice(0, -1) : RAW_API_BASE;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    credentials: "include",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const contentType = res.headers.get("content-type") ?? "";
  const parsed = contentType.includes("application/json") ? await res.json() : await res.text();

  if (!res.ok) {
    const message = (parsed && typeof parsed === "object" && "error" in parsed) ? String((parsed as { error: unknown }).error) : `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, parsed);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
};
