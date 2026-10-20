export type WorkspaceView = "graph" | "tree";
const defaultViewKey = "graph-kb:default-view";

export function defaultWorkspaceView(): WorkspaceView {
  try {
    return localStorage.getItem(defaultViewKey) === "tree" ? "tree" : "graph";
  } catch {
    return "graph";
  }
}

export function saveDefaultWorkspaceView(view: WorkspaceView) {
  localStorage.setItem(defaultViewKey, view);
}
