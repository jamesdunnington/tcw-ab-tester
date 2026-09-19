/** Password hashing lives in @tcw/core so the MCP connector's login page verifies the same hashes. */
export { hashPassword, verifyPassword } from "@tcw/core";

export const SESSION_COOKIE_NAME = "tcw_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
