import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { ToolError } from './errors.mjs';
import { CloudExtractor, providers, validateCloudConfig } from './cloud-extractor.mjs';

export class CloudSettings {
  constructor(root, options = {}) {
    this.path = join(root, 'cloud-settings.json');
    this.options = options;
    this.config = { enabled: false, provider: '', model: '', baseUrl: '', apiKey: '' };
  }
  async open() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'));
      const next = { ...this.config, provider: data.provider, model: data.model, baseUrl: data.baseUrl };
      validateCloudConfig(next);
      this.config = next;
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('云端设置文件无效，请检查 cloud-settings.json');
    }
    return this;
  }
  public() {
    const { apiKey, ...config } = this.config;
    return { ...config, hasApiKey: !!apiKey, providers };
  }
  async update(input) {
    if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['enabled', 'provider', 'model', 'baseUrl', 'apiKey'].includes(key)))
      throw new ToolError('INVALID_SETTINGS', '设置字段无效', '使用设置页面更新');
    const next = { ...this.config, ...input };
    // Switching providers or endpoints must never forward the previous provider's key.
    if ((next.provider !== this.config.provider || next.baseUrl !== this.config.baseUrl) && input.apiKey === undefined) next.apiKey = '';
    validateCloudConfig(next, next.enabled);
    const { provider, model, baseUrl } = next;
    await writeFile(`${this.path}.tmp`, JSON.stringify({ provider, model, baseUrl }, null, 2) + '\n', 'utf8');
    await rename(`${this.path}.tmp`, this.path);
    this.config = next;
    return this.public();
  }
  get enabled() { return this.config.enabled; }
  extractor() { return new CloudExtractor(this.config, this.options); }
}
