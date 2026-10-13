import { cp, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';

if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前仅验证 Windows x64 运行时打包');
const destination = resolve('src-tauri/resources/runtime');
await mkdir(join(destination, 'node_modules/kuzu'), { recursive: true });
await mkdir(join(destination, 'server'), { recursive: true });
await copyFile(process.execPath, join(destination, 'node.exe'));
await writeFile(join(destination, 'package.json'), JSON.stringify({ private: true, type: 'module', license: 'Apache-2.0' }));
for (const name of await readdir('server')) {
  if (name.endsWith('.mjs')) await copyFile(join('server', name), join(destination, 'server', name));
}
await copyFile('server/mcp-guide.md', join(destination, 'server/mcp-guide.md'));
for (const name of ['index.js', 'index.mjs', 'connection.js', 'database.js', 'prepared_statement.js', 'query_result.js', 'kuzu_native.js', 'kuzujs.node', 'LICENSE', 'package.json'])
  await copyFile(join('node_modules/kuzu', name), join(destination, 'node_modules/kuzu', name));
await copyFile('LICENSE', join(destination, 'LICENSE'));
await copyFile('THIRD_PARTY_NOTICES.md', join(destination, 'THIRD_PARTY_NOTICES.md'));
// Node's complete license includes its bundled third-party notices. Cache it so
// rebuilds work offline; never silently ship without the license text.
const nodeLicense = resolve('.tools', `node-${process.version}-LICENSE`);
let license;
try { license = await readFile(nodeLicense); }
catch {
  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`无法获取 Node ${process.version} LICENSE: HTTP ${response.status}`);
  license = Buffer.from(await response.arrayBuffer());
  await mkdir('.tools', { recursive: true });
  await writeFile(nodeLicense, license);
}
await writeFile(join(destination, 'NODE-LICENSE'), license);
async function collectLicenses(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await collectLicenses(path);
    else if (/^(LICENSE|COPYING|NOTICE|COPYRIGHT)(\.|$)/i.test(entry.name)) {
      const target = join(destination, 'licenses/kuzu', relative('node_modules/kuzu/kuzu-source', path));
      await mkdir(resolve(target, '..'), { recursive: true }); await cp(path, target);
    }
  }
}
await collectLicenses('node_modules/kuzu/kuzu-source/third_party');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const npmNotices = [];
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev) continue;
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT' && info.optional) continue; throw error; }
  const target = join(destination, 'licenses/npm', path.replaceAll('node_modules/', ''));
  await mkdir(target, { recursive: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-]|$)/i.test(entry.name)) {
      await copyFile(join(path, entry.name), join(target, entry.name)); files.push(entry.name);
    }
  }
  if (!files.length) {
    const readme = entries.find(entry => entry.isFile() && /^readme\.md$/i.test(entry.name));
    if (readme && /Permission is hereby granted/i.test(await readFile(join(path, readme.name), 'utf8'))) {
      await copyFile(join(path, readme.name), join(target, readme.name)); files.push(readme.name);
    } else {
      const fallback = join('licenses/vendor', `${path.split('/').at(-1)}-${info.version}`);
      for (const name of await readdir(fallback)) { await copyFile(join(fallback, name), join(target, name)); files.push(name); }
    }
  }
  npmNotices.push({ package: path, version: info.version, license: info.license, files });
}
await cp('licenses/vendor', join(destination, 'licenses/vendor'), { recursive: true });
await writeFile(join(destination, 'licenses/npm-packages.json'), JSON.stringify(npmNotices, null, 2));
await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify({ node: process.version, kuzu: JSON.parse(await readFile('node_modules/kuzu/package.json', 'utf8')).version, platform: process.platform, arch: process.arch }, null, 2));
console.log('Prepared self-contained Windows runtime (Node + Kùzu + service + licenses)');
