// Run only a supplied test executable, with isolated data and no system Node PATH.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const exe = resolve(process.argv[2] ?? ".tools/installed-smoke/graph-kb.exe");
await mkdir(".graph-kb", { recursive: true });
const data = await mkdtemp(resolve(".graph-kb/native-mvp-"));
const env = {
  ...process.env,
  GRAPH_KB_DATA_DIR: data,
  WEBVIEW2_USER_DATA_FOLDER: resolve(data, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9223",
};
for (const key of Object.keys(env))
  if (["path", "node_path", "node_options"].includes(key.toLowerCase()))
    delete env[key];
env.PATH = "";
const app = spawn(exe, [], {
  env,
  cwd: tmpdir(),
  windowsHide: true,
  stdio: "ignore",
});
const exited = once(app, "exit");
try {
  let ready = false;
  for (let n = 0; n < 150; n++) {
    if (app.exitCode !== null) throw Error("Desktop exited before startup");
    try {
      const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
      ready = targets.some((t) => t.type === "page");
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "Desktop debugging page unavailable");
  const check = spawn(process.execPath, ["scripts/verify-desktop.mjs"], {
    stdio: "inherit",
    windowsHide: true,
  });
  assert.equal((await once(check, "exit"))[0], 0);
  const timeout = setTimeout(() => app.kill(), 10000);
  try {
    assert.equal((await exited)[0], 0);
  } finally {
    clearTimeout(timeout);
  }
  console.log(
    "PASS: installed application, empty PATH, temporary working directory, isolated graph data, clean exit",
  );
} finally {
  if (app.exitCode === null) app.kill();
}
