import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Previews the website as it is on GitHub, from a separate copy of the repository in
// .cache/github-review. The member's own files and edits are never read or changed.
export const REVIEW_BRANCH = /^(?!.*\.\.)(?![/.-])(?!.*[/.]$)[A-Za-z0-9._/-]{1,120}$/;
const PACKAGES = ['web', 'office'];

function run(command, args, cwd, timeout = 15 * 60_000) {
  return new Promise((resolve, reject) => {
    // npm is a .cmd script on Windows, which needs a shell; every argument here is fixed or validated.
    execFile(command, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' && command === 'npm' },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout.trim());
        const detail = String(stderr || error.message).trim().split('\n').filter(Boolean).slice(-2).join(' ');
        reject(new Error(detail || `${command} failed`));
      });
  });
}

export function createGithubReview({ root, port = 4175, defaultBranch = 'review/local-web', startPreview, webConfig = () => ({}) }) {
  if (!REVIEW_BRANCH.test(defaultBranch)) throw new Error('Invalid default review branch.');
  const dir = path.join(root, '.cache', 'github-review');
  const previewUrl = `http://127.0.0.1:${port}`;
  let state = { state: 'off', previewUrl };
  let server = null, pending = null, stopped = false;
  const git = (args, cwd = root) => {
    // Worktree metadata can exceed Windows' legacy path limit. Pass a relative git-dir.
    let prefix = [];
    const marker = path.join(cwd, '.git');
    try {
      const text = readFileSync(marker, 'utf8');
      if (text.startsWith('gitdir: ')) prefix = ['--git-dir=' + path.relative(cwd, path.resolve(cwd, text.slice(8).trim())), '--work-tree=.'];
    } catch { /* Normal repository directory. */ }
    return run(process.env.GIT_BINARY || 'git', [...prefix, '-c', 'gc.auto=0', '-c', 'core.longpaths=true', ...args], cwd);
  };

  async function checkout(branch) {
    state = { ...state, step: 'Getting the latest from GitHub' };
    await git(['fetch', '--no-tags', 'origin', `+refs/heads/${branch}:refs/local-web/github-review`]);
    const sha = await git(['rev-parse', 'refs/local-web/github-review^{commit}']);
    if (existsSync(path.join(dir, '.git'))) {
      if (await git(['status', '--porcelain', '--untracked-files=no'], dir)) throw new Error('The GitHub snapshot has local edits. Save them before updating; nothing was overwritten.');
      await git(['checkout', '--detach', sha], dir);
    } else {
      await git(['worktree', 'add', '--detach', dir, sha]);
    }
    const [subject, date] = (await git(['log', '-1', '--format=%s%x00%cI', sha])).split('\0');
    return { sha, subject, date };
  }

  // Packages install only when a lockfile changes, so later updates take seconds.
  async function install() {
    const recordPath = path.join(root, '.cache', 'github-review-packages.json');
    let record = {};
    try { record = JSON.parse(await readFile(recordPath, 'utf8')); } catch { /* first install */ }
    let changed = false;
    for (const name of PACKAGES) {
      const lock = createHash('sha256').update(await readFile(path.join(dir, name, 'package-lock.json'))).digest('hex');
      if (record[name] === lock && existsSync(path.join(dir, name, 'node_modules'))) continue;
      state = { ...state, step: `Installing ${name} packages (the first time takes a few minutes)` };
      await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], path.join(dir, name));
      record[name] = lock; changed = true;
      await writeFile(recordPath, JSON.stringify(record));
    }
    return changed;
  }

  // Restart after every update so changed Vite configuration is applied.
  async function serve() {
    if (stopped) return;
    state = { ...state, step: 'Starting the preview' };
    await server?.close();
    server = null;
    if (startPreview) {
      server = await startPreview({ root: dir, port });
      return;
    }
    const { createServer } = await import(pathToFileURL(path.join(dir, 'web', 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
    const config = webConfig();
    server = await createServer({ ...config, root: path.join(dir, 'web'), configFile: path.join(dir, 'web', 'vite.config.js'),
      server: { ...config.server, host: '127.0.0.1', port, strictPort: true } });
    await server.listen();
  }

  function update(branch = defaultBranch) {
    if (stopped) throw new Error('The local workspace is stopping.');
    if (typeof branch !== 'string' || !REVIEW_BRANCH.test(branch)) {
      throw Object.assign(new Error('Enter a GitHub branch name, such as main.'), { status: 400 });
    }
    if (!pending) {
      state = { ...state, state: 'updating', branch, error: null };
      pending = (async () => {
        try {
          await server?.close(); server = null;
          const commit = await checkout(branch);
          await install();
          await serve();
          if (stopped) return;
          state = { state: 'ready', previewUrl, branch, ...commit, updatedAt: new Date().toISOString() };
        } catch (error) {
          state = { ...state, state: 'error', step: null, error: error.message || 'The GitHub version could not be loaded.' };
        } finally { pending = null; }
      })();
    }
    return { ...state, defaultBranch };
  }

  return {
    getStatus: () => ({ ...state, defaultBranch }),
    update,
    async stop() { stopped = true; await pending; await server?.close(); server = null; },
  };
}
