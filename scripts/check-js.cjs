const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('../web/node_modules/@babel/parser');
const traverse = require('../web/node_modules/@babel/traverse').default;

const root = path.resolve(__dirname, '..');
const globals = new Set([
  ...Object.getOwnPropertyNames(globalThis), 'require', 'module', 'exports', '__dirname', '__filename',
  'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'screen', 'history',
  'HTMLElement', 'HTMLMediaElement', 'HTMLVideoElement', 'Element', 'Node', 'Image', 'ImageData',
  'Audio', 'File', 'FileReader', 'FormData', 'Blob', 'DOMParser', 'XMLSerializer', 'XMLHttpRequest',
  'IntersectionObserver', 'ResizeObserver', 'MutationObserver', 'EventSource', 'WebSocket', 'Worker',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'alert', 'confirm', 'prompt',
  'matchMedia', 'CustomEvent', 'Event', 'PointerEvent', 'TouchEvent', 'Touch', 'MediaRecorder',
  'btoa', 'atob', 'performance', 'crypto', 'indexedDB', 'Notification', '__DEV__',
]);
const roots = ['backend', 'web/src', 'office/src', 'mobile'];
const skip = new Set(['node_modules', 'dist', 'data', '.expo', '.cache']);
let count = 0;
const errors = [];
function visit(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { if (!skip.has(item.name)) visit(file); continue; }
    if (!/\.(js|jsx|cjs|mjs)$/.test(item.name)) continue;
    count++;
    try {
      const ast = parse(fs.readFileSync(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx'] });
      traverse(ast, { ReferencedIdentifier(ref) {
        const name = ref.node.name;
        if (!globals.has(name) && !ref.scope.hasBinding(name)) {
          errors.push(`${path.relative(root, file)}:${ref.node.loc.start.line}: undefined ${name}`);
        }
      } });
    } catch (error) { errors.push(`${path.relative(root, file)}: ${error.message}`); }
  }
}
for (const directory of roots) visit(path.join(root, directory));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`PASS: ${count} JavaScript/JSX files parsed with no unbound references`);
