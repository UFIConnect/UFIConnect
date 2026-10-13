const path = require('node:path');
const fs = require('node:fs');
const expoWorker = require('@expo/metro-config/build/transform-worker/transform-worker');
const webSource = path.resolve(__dirname, '../../web/src') + path.sep;
const webPublic = path.resolve(__dirname, '../../web/public');
module.exports = {
  ...expoWorker,
  transform(config, projectRoot, filename, data, options) {
    const fullPath = path.resolve(projectRoot, filename);
    if (fullPath.startsWith(webSource) && fullPath.endsWith('.css')) {
      // Metro does not yet resolve local CSS url() resources. Embed this small
      // shared font so both the browser and bundled native document can load it.
      data = Buffer.from(data.toString().replace(/url\((['"]?)\/(brand\/[^)'"\s]+)\1\)/g, (_, quote, asset) => {
        const target = path.resolve(webPublic, asset);
        if (!target.startsWith(webPublic + path.sep) || !target.endsWith('.woff2')) throw new Error('Unsupported shared CSS asset: ' + asset);
        return `url('data:font/woff2;base64,${fs.readFileSync(target).toString('base64')}')`;
      }));
    }
    return expoWorker.transform(config, projectRoot, filename, data, options);
  },
};
