/**
 * Generates a TWA Android project from our config without any interactive prompts.
 * Run: node build-twa.js
 */
const path  = require('path');
const fs    = require('fs');
const http  = require('http');

const BUBBLEWRAP_CORE = path.join(
  'C:\\Users\\Yosuf\\AppData\\Roaming\\npm\\node_modules',
  '@bubblewrap\\cli\\node_modules\\@bubblewrap\\core\\dist\\lib'
);

// Find the JDK home from the installed Temurin
function findJavaHome() {
  const candidates = [
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot',
    'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10',
    process.env.JAVA_HOME,
  ].filter(Boolean);
  return candidates.find(p => p && fs.existsSync(p)) || 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.11.10-hotspot';
}

// Serve local public/ files on localhost so bubblewrap can download icons
function startIconServer(publicDir, port) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const filePath = path.join(publicDir, req.url.split('?')[0]);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        const mime = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        fs.createReadStream(filePath).pipe(res);
      } else {
        res.writeHead(404); res.end();
      }
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

async function main() {
  const { TwaManifest }  = require(path.join(BUBBLEWRAP_CORE, 'TwaManifest'));
  const { TwaGenerator } = require(path.join(BUBBLEWRAP_CORE, 'TwaGenerator'));
  const { Config }       = require(path.join(BUBBLEWRAP_CORE, 'Config'));
  const { ConsoleLog }   = require(path.join(BUBBLEWRAP_CORE, 'Log'));

  const log        = new ConsoleLog('twa-builder');
  const JAVA_HOME  = findJavaHome();
  const ANDROID_SDK = process.env.ANDROID_HOME ||
    path.join(process.env.USERPROFILE, 'android-sdk');

  console.log('JDK:', JAVA_HOME);
  console.log('Android SDK:', ANDROID_SDK);

  // Serve local public/ so icon URLs resolve
  const PORT      = 19876;
  const PUBLIC    = path.join(__dirname, 'web', 'public');
  const iconSrv   = await startIconServer(PUBLIC, PORT);
  const iconBase  = `http://127.0.0.1:${PORT}`;

  const twaManifest = new TwaManifest({
    packageId:            'org.uficonnect.app',
    host:                 'uficonnect.org',
    name:                 'UFIConnect',
    launcherName:         'UFIConnect',
    display:              'standalone',
    themeColor:           '#6366F1',
    themeColorDark:       '#4F46E5',
    navigationColor:      '#6366F1',
    backgroundColor:      '#FFFFFF',
    startUrl:             '/',
    iconUrl:              `${iconBase}/icon-512.png`,
    maskableIconUrl:      `${iconBase}/icon-512.png`,
    enableNotifications:  true,
    signingKey:           { path: './android.keystore', alias: 'uficonnect' },
    appVersion:           '1.0.0',
    appVersionCode:       1,
    minSdkVersion:        21,
    orientation:          'portrait',
    generatorApp:         'bubblewrap-cli',
    webManifestUrl:       'https://uficonnect.org/manifest.json',
    shortcuts:            [],
    isChromeOSOnly:       false,
    isMetaQuest:          false,
    fingerprints:         [],
  });

  const outputDir = path.join(__dirname, 'android-twa');
  const generator = new TwaGenerator();

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }

  console.log('\nGenerating Android TWA project at:', outputDir);
  await generator.createTwaProject(outputDir, twaManifest, log, (cur, total) => {
    process.stdout.write(`\r  Step ${cur}/${total}`);
  });

  // Save the bubblewrap manifest alongside the project
  await twaManifest.saveToFile(path.join(outputDir, 'twa-manifest.json'));

  iconSrv.close();
  console.log('\n✅  Android project created at: android-twa/');
  console.log('\nNext steps:');
  console.log('  1. Generate signing key (if first time):');
  console.log('     cd android-twa && ..\\gradlew-setup   (or use bubblewrap build)');
  console.log('  2. Run:  cd android-twa && gradlew bundleRelease');
  console.log('  3. Upload app-release-bundle.aab to Play Console');
}

main().catch(err => {
  console.error('\nError:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
