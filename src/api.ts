import { isTauri, invoke } from "@tauri-apps/api/core";

let connection: Promise<{ url: string; token: string }> | undefined;
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let base = "";
  if (isTauri()) {
    connection ??= invoke("api_connection");
    const config = await connection;
    base = config.url;
    headers.Authorization = `Bearer ${config.token}`;
  }
  const response = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(`${result.error.message}。${result.error.suggestion}`);
  return result;
}
export interface KnowledgeBase {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt?: string;
}
export interface PageNode {
  properties: Record<string, unknown>;
  id: string;
  kbId: string;
  title: string;
  markdown: string;
  revision: number;
  kind: string;
  updatedAt: string;
}
export interface GraphEdge {
  properties: Record<string, unknown>;
  id: string;
  label: string;
  source: string;
  target: string;
  type: "CHILD_OF" | "SIBLING_OF";
}
export interface GraphData {
  nodes: PageNode[];
  edges: GraphEdge[];
}
