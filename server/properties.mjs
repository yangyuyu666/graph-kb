import { ToolError } from "./errors.mjs";

// Store JSON as a single value. Never merge user keys into core records or prototypes.
export function encodeProperties(value) {
  const invalid = () => new ToolError("INVALID_PROPERTIES", "properties 须为 JSON 对象，最多 64 KiB、嵌套深度不超过 16", "省略保留原值；传 {} 清空；更新时提交完整属性对象");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const seen = new Set();
  function visit(item, depth) {
    if (depth > 16) throw invalid();
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || seen.has(item)) throw invalid();
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw invalid();
    seen.add(item);
    for (const child of Object.values(item)) visit(child, depth + 1);
    seen.delete(item);
  }
  visit(value, 0);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > 64 * 1024) throw invalid();
  return json;
}

export function propertiesObject(value = {}) {
  return JSON.parse(encodeProperties(value));
}

export function decodeProperties(value) {
  return propertiesObject(JSON.parse(value ?? "{}"));
}
