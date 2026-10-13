import { requireId } from "./errors.mjs";
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export function parseReference(value) {
  const parts = String(value).split("/");
  if (parts.length === 1) return { id: requireId(parts[0]) };
  if (parts.length === 2) return { kbId: requireId(parts[0]), id: requireId(parts[1]) };
  return { id: requireId("") };
}
export function rewriteReferences(markdown, resolve) {
  return markdown.replace(new RegExp(`node:(${uuid}(?:/${uuid})?)(?![0-9a-f/-])`, "gi"),
    (whole, reference) => `node:${resolve(parseReference(reference)) ?? reference}`);
}
