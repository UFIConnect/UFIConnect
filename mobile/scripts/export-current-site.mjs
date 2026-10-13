import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const args = process.argv.slice(2);
const child = spawn(process.execPath, [cli, 'export', ...(args.includes('--platform') ? [] : ['--platform', 'web']), ...args], {
  cwd: mobileRoot, stdio: 'inherit', env: { ...process.env, EXPO_NO_BUNDLE_SPLITTING: '1' },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
