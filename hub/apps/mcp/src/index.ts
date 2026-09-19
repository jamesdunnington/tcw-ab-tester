import { encryptSecret, decryptSecret } from "@tcw/core";
import { env } from "./env.js";
import { db } from "./db.js";
import { createApp } from "./app.js";

const app = createApp({
  db,
  publicUrl: env.MCP_PUBLIC_URL,
  sessionSecret: env.SESSION_SECRET,
  box: { encrypt: encryptSecret, decrypt: decryptSecret },
});

app.listen(env.PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`TCW MCP connector listening on ${env.PORT} (public URL ${env.MCP_PUBLIC_URL})`);
});
