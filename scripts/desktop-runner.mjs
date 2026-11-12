import { spawn } from 'node:child_process';
import { openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const [file, encoded] = process.argv.slice(2);
if (!file || !encoded) process.exit(2);
const command = Buffer.from(encoded, 'base64').toString('utf8');
const output = openSync(file, 'a');
const runner = spawn('cmd.exe', ['/d', '/s', '/c', command], { cwd: resolve(import.meta.dirname, '..'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
for (const stream of [runner.stdout, runner.stderr]) stream.on('data', chunk => writeSync(output, chunk));
process.stdin.pipe(runner.stdin);
runner.on('error', error => { writeSync(output, `${error.message}\n`); closeSync(output); process.exitCode = 1; });
runner.on('close', code => { closeSync(output); process.exitCode = code ?? 1; });
