import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, delimiter } from 'node:path';

const env = { ...process.env };
const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] = `${join(homedir(), '.cargo', 'bin')}${delimiter}${env[pathKey] ?? ''}`;
env.GRAPH_KB_NODE = process.execPath;
// Tauri validates resource paths even in development. Prepare on a fresh clone.
if (process.argv[2] !== 'build') await import('./prepare-runtime.mjs');
const child = spawn(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...(process.argv.slice(2).length ? process.argv.slice(2) : ['dev'])], { env, stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
