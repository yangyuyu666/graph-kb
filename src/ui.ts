export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
export function button(label: string, action: () => unknown, className = "") {
  const el = element("button", label, className);
  el.type = "button";
  el.onclick = () => void Promise.resolve().then(action).catch(report);
  return el;
}
export function report(error: unknown) {
  const status = document.querySelector<HTMLElement>("#status");
  if (status)
    status.textContent = error instanceof Error ? error.message : String(error);
}
export function modal(title: string) {
  const dialog = document.createElement("dialog");
  dialog.className = "app-dialog";
  const form = element("form");
  form.append(element("h2", title));
  const error = element("p");
  error.setAttribute("role", "alert");
  const actions = element("div", undefined, "actions");
  actions.append(button("取消", () => dialog.close()));
  const submit = element("button", "确定", "primary");
  submit.type = "submit";
  actions.append(submit);
  dialog.append(form);
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  return {
    dialog,
    form,
    error,
    actions,
    submit,
    show: () => {
      form.append(error, actions);
      dialog.showModal();
    },
  };
}
export function field(form: HTMLElement, title: string, input: HTMLElement) {
  const label = element("label");
  label.append(element("span", title), input);
  form.append(label);
  return input;
}
export function nameDialog(
  title: string,
  label: string,
  save: (value: string) => Promise<unknown>,
  initial = "",
) {
  const m = modal(title);
  const input = element("input");
  input.value = initial;
  input.required = true;
  input.maxLength = 200;
  field(m.form, label, input);
  m.submit.textContent = initial ? "保存" : "创建";
  m.form.onsubmit = async (e) => {
    e.preventDefault();
    m.submit.disabled = true;
    try {
      await save(input.value);
      m.dialog.close();
    } catch (error) {
      m.error.textContent = String(error);
      m.submit.disabled = false;
    }
  };
  m.show();
}
export function confirmTrash(
  title: string,
  save: () => Promise<unknown>,
  detail = "节点将保留 30 天，关联边会移除；失去所有父节点的子节点会提升为顶级节点，期间可在回收站恢复。",
) {
  const m = modal(`删除“${title}”`);
  m.form.append(element("p", detail));
  m.submit.textContent = "移入回收站";
  m.submit.classList.add("danger");
  m.form.onsubmit = async (e) => {
    e.preventDefault();
    m.submit.disabled = true;
    try {
      await save();
      m.dialog.close();
    } catch (error) {
      m.error.textContent = String(error);
      m.submit.disabled = false;
    }
  };
  m.show();
}
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = element("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const kindNames: Record<string, string> = {
  Page: "页面",
  Tag: "标签",
  File: "文件",
  Person: "人物",
  Task: "任务",
};
