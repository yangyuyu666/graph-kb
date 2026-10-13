export class ToolError extends Error {
  constructor(code, message, suggestion, status = 400) {
    super(message);
    Object.assign(this, { code, suggestion, status });
  }
}
export function requireText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new ToolError('INVALID_INPUT', `${label}须为 1–${max} 字符的非空文本`, '检查输入内容后重试');
  return value.trim();
}
export function requireId(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new ToolError('INVALID_ID', '节点或知识库 ID 无效', '使用接口返回的 UUID');
  return value;
}
