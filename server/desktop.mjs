import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { GraphStore } from "./graph-store.mjs";
import { KnowledgeTools } from "./tools.mjs";
import { startApi } from "./http.mjs";
import { CloudSettings } from "./cloud-settings.mjs";

const dataDir = process.argv[2];
if (!dataDir) throw new Error("Tauri must provide an app data directory");
const store = await new GraphStore(resolve(dataDir)).open();
const token = randomBytes(32).toString("hex");
const cloudSettings = await new CloudSettings(store.root).open();
const tools = new KnowledgeTools(store, { cloudSettings });
await store.run(() => tools.expireTrash());
const api = await startApi(tools, token);
const purgeTimer = setInterval(
  () =>
    store
      .run(() => tools.expireTrash())
      .catch(() => console.error("回收站清理失败，请重启服务恢复")),
  60 * 60 * 1000,
);
purgeTimer.unref();
// Private stdout handshake to the parent, never write this to public logs.
process.stdout.write(`${JSON.stringify({ url: api.url, token })}\n`);
async function shutdown() {
  if (shutdown.started) return;
  shutdown.started = true;
  clearInterval(purgeTimer);
  api.server.closeAllConnections();
  await new Promise((resolve) => api.server.close(resolve));
  await store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Parent closes the pipe on exit, including abnormal termination.
process.stdin.resume();
process.stdin.on("end", shutdown);
