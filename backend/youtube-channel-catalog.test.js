const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const verified = require('./youtube-channel-catalog.verified.json');

test('configured YouTube creators match identities verified on official channels and RSS', () => {
  const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
  const read = name => vm.runInNewContext('(' + source.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\r?\\n`))[1] + ')');
  const configured = [...Object.values(read('TOPIC_YT_CHANNELS')).flat(), ...read('DEFAULT_YT_CHANNELS')];
  const byName = new Map(verified.channels.map(channel => [channel.name, channel]));
  assert.equal(byName.size, 44);
  assert.equal(new Set(verified.channels.map(channel => channel.id)).size, 44);
  assert.deepEqual([...new Set(configured.map(channel => channel.name))].sort(), [...byName.keys()].sort());
  for (const channel of configured) {
    const proof = byName.get(channel.name);
    assert.equal(channel.id, proof.id, `${channel.name} must use its verified creator ID`);
    assert.match(channel.id, /^UC[\w-]{22}$/);
    assert.equal(new URL(proof.officialUrl).hostname, 'www.youtube.com');
    assert.equal(new URL(proof.feedUrl).searchParams.get('channel_id'), channel.id);
    assert.equal(proof.rssStatus, 200);
    assert.ok(proof.rssEntries > 0);
    assert.match(proof.verifiedOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});
