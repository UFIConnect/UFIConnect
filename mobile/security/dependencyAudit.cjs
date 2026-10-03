const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { processPatches, manifest } = require('./dependencyPatches.cjs');

function assessAudit(report, verified, now = new Date()) {
  if (report.error || report.auditReportVersion !== 2 || !report.vulnerabilities || !report.metadata?.vulnerabilities) throw new Error('Invalid or unavailable npm audit report');
  if (now >= new Date(manifest.reviewBy + 'T00:00:00Z')) throw new Error('Security backports require upstream review before further release');
  const vulnerabilities = report.vulnerabilities;
  const covered = (name, seen, causes) => {
    const item = vulnerabilities[name];
    if (!item || !Array.isArray(item.via) || !item.via.length) return false;
    if (seen.has(name)) return true; // npm's transitive dependency graph contains cycles.
    seen.add(name);
    return item.via.every(cause => {
      if (typeof cause === 'string') return covered(cause, seen, causes);
      const patch = verified.get(name);
      causes.add(cause.url);
      return patch && cause.name === name && cause.url === `https://github.com/advisories/${patch.advisory}` &&
        item.nodes?.length > 0 && item.nodes.every(node => patch.nodes.has(node));
    });
  };
  const mitigated = name => {
    const causes = new Set();
    return covered(name, new Set(), causes) && causes.size > 0;
  };
  const blocked = Object.entries(vulnerabilities).filter(([name, item]) => ['high', 'critical'].includes(item.severity) && !mitigated(name)).map(([name]) => name);
  return { blocked, mitigated: Object.keys(vulnerabilities).filter(name => mitigated(name)) };
}

function main() {
  const verified = processPatches();
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) throw new Error('Run with npm run audit:security');
  const result = spawnSync(process.execPath, [npm, 'audit', '--json', '--audit-level=high'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('npm audit could not complete');
  const report = JSON.parse(result.stdout);
  const directory = path.resolve(__dirname, '../.cache');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'dependency-audit.json'), JSON.stringify(report, null, 2) + '\n');
  const assessment = assessAudit(report, verified);
  console.log('Raw npm audit report: mobile/.cache/dependency-audit.json');
  console.log('Verified local backports (upstream advisories remain open):', [...verified.keys()].join(', '));
  if (assessment.blocked.length) throw new Error('Unpatched high/critical advisories: ' + assessment.blocked.join(', '));
  console.log('No unpatched high/critical dependency advisories. Backport review due ' + manifest.reviewBy + '.');
}
module.exports = { assessAudit };
if (require.main === module) main();
