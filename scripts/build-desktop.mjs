import { spawnSync } from 'node:child_process';

for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build'], ['scripts/prepare-runtime.mjs'], ['scripts/collect-rust-licenses.mjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
