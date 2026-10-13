import { readFile, writeFile, mkdir } from 'node:fs/promises';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const dependencies = Object.entries(lock.packages).filter(([path]) => path).map(([path, p]) => ({
  path, version: p.version, license: p.license ?? 'UNKNOWN', development: p.dev === true,
}));
const blocked = dependencies.filter(p => /(?:^|[^A-Z])(?:A|L)?GPL(?:-|\b)/i.test(p.license) || p.license === 'UNKNOWN');
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/npm-licenses.json', JSON.stringify({
  scope: 'npm lockfile metadata, including optional platform packages; not a complete native-binary license audit',
  dependencies, blocked,
}, null, 2) + '\n');
console.log(`Checked ${dependencies.length} lockfile entries; GPL/AGPL/LGPL or unknown: ${blocked.length}`);
if (blocked.length) { console.error(blocked); process.exitCode = 1; }
