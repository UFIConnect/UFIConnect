import test from 'node:test';
import assert from 'node:assert/strict';
import { sourcePostCommands } from './sourceCommands.mjs';

test('Mastodon uses favourite and reply commands, Git hosts use stars and Reddit uses votes', () => {
  const mastodon = sourcePostCommands('mastodon');
  assert.equal(mastodon.reaction, 'Favourite');
  assert.equal(mastodon.undoReaction, 'Remove favourite');
  assert.equal(mastodon.icon, 'star');
  assert.equal(mastodon.discussions, 'Replies');
  for (const source of ['github', 'gitlab']) {
    assert.equal(sourcePostCommands(source).icon, 'star');
    assert.equal(sourcePostCommands(source).metric, 'stars');
  }
  assert.equal(sourcePostCommands('reddit').reaction, 'Upvote');
  assert.equal(sourcePostCommands('reddit').metric, 'points');
  assert.equal(sourcePostCommands('youtube').icon, 'thumbs-up');
  assert.equal(sourcePostCommands('medium').reaction, 'Clap');
});

test('publisher, career and nonreaction sources never get a generic like command', () => {
  for (const source of ['arxiv', 'techcrunch', 'remotive', 'twitch', 'discord', 'figma', 'pinterest', 'unknown']) {
    assert.equal(sourcePostCommands(source).reaction, null, source);
  }
  assert.equal(sourcePostCommands('uficonnect').reaction, 'Like');
  assert.equal(sourcePostCommands('livecamera').reaction, 'Like');
  assert.equal(sourcePostCommands('x'), sourcePostCommands('twitter'));
});
