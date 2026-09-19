/** Outcome of a core service call. Routes map it to HTTP, MCP tools map it to a tool error. */
export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; detail?: unknown };

export const ok = <T>(data: T): ServiceResult<T> => ({ ok: true, data });
export const fail = (status: number, error: string, detail?: unknown): ServiceResult<never> => ({ ok: false, status, error, detail });
