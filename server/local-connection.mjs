// Stable MCP configuration points here; the app publishes a fresh private session.
import { closeSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";

export function validConnection(connection) {
  const port = /^http:\/\/127\.0\.0\.1:(\d+)$/.exec(connection?.url ?? "")?.[1];
  return !!port && Number(port) > 0 && Number(port) < 65536 &&
    typeof connection.token === "string" && connection.token.length > 0 && connection.token.length <= 4096 &&
    !/[\r\n]/.test(connection.token);
}

export function readConnection(file) {
  if (!isAbsolute(file) || statSync(file).size > 8192) throw new Error("Invalid session file");
  const connection = JSON.parse(readFileSync(file, "utf8"));
  if (!validConnection(connection)) throw new Error("Invalid local session");
  return connection;
}

export function publishConnection(root, connection) {
  if (!isAbsolute(root) || !validConnection(connection)) throw new Error("Invalid local connection");
  const file = join(root, "mcp-session.json");
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    // Create an empty file first: no token exists before access is restricted.
    closeSync(openSync(temporary, "wx", 0o600));
    if (process.platform === "win32") {
      const system = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
      const options = { windowsHide: true, timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
      const identity = execFileSync(join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], options);
      const sid = identity.match(/S-1-\d+(?:-\d+)+/)?.[0];
      if (!sid) throw new Error("Current user SID unavailable");
      execFileSync(join(system, "icacls.exe"), [temporary, "/inheritance:r", "/grant:r", `*${sid}:(F)`], options);
    }
    writeFileSync(temporary, JSON.stringify(connection) + "\n", { mode: 0o600 });
    renameSync(temporary, file);
    return file;
  } catch {
    try { unlinkSync(temporary); } catch { /* No credentials are logged. */ }
    throw new Error("无法建立私有 MCP 会话文件，请检查数据目录权限");
  }
}

export function clearConnection(file, token) {
  try {
    // A late close must not remove a newer server's session.
    if (readConnection(file).token === token) unlinkSync(file);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("MCP 会话文件清理失败；下次启动会替换旧会话");
  }
}
