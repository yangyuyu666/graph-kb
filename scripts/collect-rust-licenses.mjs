import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const cargo = join(homedir(), '.cargo/bin/cargo.exe');
const metadata = JSON.parse(execFileSync(cargo, ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true }));
const destination = resolve('src-tauri/resources/runtime/licenses/rust');
await mkdir(destination, { recursive: true });
const notices = [];
for (const pkg of metadata.packages.filter(pkg => pkg.source)) {
  if (!pkg.license || /\b(A?GPL|LGPL)/.test(pkg.license)) throw new Error(`需人工核查 Rust 协议: ${pkg.name} ${pkg.license}`);
  const source = dirname(pkg.manifest_path), target = join(destination, `${pkg.name}-${pkg.version}`);
  await mkdir(target, { recursive: true });
  const files = [];
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE|COPYRIGHT)([._-]|$)/i.test(entry.name)) {
      await copyFile(join(source, entry.name), join(target, entry.name)); files.push(entry.name);
    }
  }
  if (!files.length) {
    const fallback = join('licenses/vendor', `${pkg.name}-${pkg.version}`);
    for (const name of await readdir(fallback)) { await copyFile(join(fallback, name), join(target, name)); files.push(name); }
  }
  // Preserve unmodified MPL-covered source alongside the compiled artifact.
  if (pkg.license === 'MPL-2.0') await cp(source, join(target, 'source'), { recursive: true });
  notices.push({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository, source: `https://crates.io/crates/${pkg.name}/${pkg.version}`, files });
}
await writeFile(join(destination, 'packages.json'), JSON.stringify(notices, null, 2));
await writeFile('docs/evidence/rust-licenses.json', JSON.stringify(notices, null, 2) + '\n');
console.log(`Collected ${notices.length} Rust dependency notices (Windows resolution, including build dependencies)`);
