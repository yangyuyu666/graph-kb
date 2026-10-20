/** Enlarge the existing editor in the top layer, preserving its draft and history. */
export function enhanceCodeBlocks(root: HTMLElement, signal: AbortSignal) {
  const blocks = new Map<HTMLElement, HTMLButtonElement>();
  const enhance = () => {
    for (const [block] of blocks) if (!root.contains(block)) blocks.delete(block);
    root.querySelectorAll<HTMLElement>(".milkdown-code-block").forEach((block) => {
      const toolbar = block.querySelector(".tools-button-group");
      if (!toolbar || toolbar.querySelector(".code-enlarge")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-enlarge";
      button.textContent = "放大查看";
      button.setAttribute("aria-expanded", "false");
      button.title = "放大代码块，按 Esc 返回";
      // Popovers stay in their original DOM location; no editor is cloned or moved.
      block.popover = "auto";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        block.togglePopover();
      }, { signal });
      block.addEventListener("toggle", () => {
        const expanded = block.matches(":popover-open");
        button.textContent = expanded ? "收起 · Esc" : "放大查看";
        button.setAttribute("aria-expanded", String(expanded));
      }, { signal });
      toolbar.append(button);
      blocks.set(block, button);
    });
  };
  // Milkdown mounts code editors lazily and also creates them while typing.
  const observer = new MutationObserver(enhance);
  observer.observe(root, { childList: true, subtree: true });
  enhance();
  signal.addEventListener("abort", () => {
    observer.disconnect();
    for (const [block, button] of blocks) {
      if (block.matches(":popover-open")) block.hidePopover();
      block.removeAttribute("popover");
      button.remove();
    }
    blocks.clear();
  }, { once: true });
}
