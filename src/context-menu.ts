import { element, button } from "./ui";
export interface MenuAction {
  label: string;
  icon: string;
  run: () => unknown;
  danger?: boolean;
  separator?: boolean;
}
let dismiss: (() => void) | undefined;
export function closeContextMenu() {
  dismiss?.();
}
export function contextMenu(
  x: number,
  y: number,
  title: string,
  actions: MenuAction[],
) {
  closeContextMenu();
  const previous = document.activeElement as HTMLElement | null;
  const menu = element("div", undefined, "node-context-menu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `${title} 操作`);
  const abort = new AbortController();
  const close = () => {
    abort.abort();
    menu.remove();
    dismiss = undefined;
  };
  dismiss = close;
  for (const action of actions) {
    if (action.separator) {
      const line = element("div", undefined, "menu-separator");
      line.setAttribute("role", "separator");
      menu.append(line);
    }
    const item = button(
      "",
      () => {
        close();
        return action.run();
      },
      action.danger ? "menu-item danger-link" : "menu-item",
    );
    item.setAttribute("role", "menuitem");
    item.setAttribute("aria-label", action.label);
    item.append(
      element("span", action.icon, "menu-icon"),
      element("span", action.label),
    );
    menu.append(item);
  }
  document.body.append(menu);
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!menu.contains(e.target as Node)) close();
    },
    { signal: abort.signal, capture: true },
  );
  window.addEventListener("resize", close, { signal: abort.signal });
  window.addEventListener("blur", close, { signal: abort.signal });
  document.addEventListener(
    "keydown",
    (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>("[role=menuitem]")];
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        previous?.focus();
      }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? items.length - 1
              : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                items.length;
        items[next]?.focus();
      }
      if (e.key === "Tab") close();
    },
    { signal: abort.signal },
  );
}
