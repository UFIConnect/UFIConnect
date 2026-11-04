import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PIP_TONE, PIP_TONE_STORAGE_KEY, PIP_TONES, getPipTone, loadPipTone, savePipTone } from './pip-tones.mjs';

test('Pip offers distinct bounded voice profiles and invalid preferences fall back to Friendly', () => {
  assert.deepEqual(PIP_TONES.map(tone => tone.id), ['friendly', 'calm', 'playful', 'professional']);
  assert.equal(getPipTone('make arbitrary changes').id, DEFAULT_PIP_TONE);
  assert.equal(getPipTone('__proto__').id, DEFAULT_PIP_TONE);
  assert.ok(getPipTone('calm').speech.rate < getPipTone('friendly').speech.rate);
  assert.ok(getPipTone('playful').speech.pitch > getPipTone('professional').speech.pitch);
  assert.ok(PIP_TONES.every(tone => tone.speech.rate >= .85 && tone.speech.rate <= 1.1 && tone.speech.pitch >= .9 && tone.speech.pitch <= 1.2));
  assert.ok(PIP_TONES.every(tone => Object.isFrozen(tone) && Object.isFrozen(tone.speech)));
});

test('tone storage persists only a canonical preference and stays usable when browser storage fails', () => {
  const values = new Map(), writes = [];
  const storage = { getItem: key => values.get(key), setItem: (key, value) => { writes.push([key, value]); values.set(key, value); } };
  assert.equal(loadPipTone(storage), DEFAULT_PIP_TONE);
  assert.equal(savePipTone('calm', storage), 'calm');
  assert.equal(loadPipTone(storage), 'calm');
  assert.deepEqual(writes, [[PIP_TONE_STORAGE_KEY, 'calm']]);
  assert.equal(savePipTone('unknown private message', storage), 'friendly');
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(loadPipTone(blocked), 'friendly'); assert.equal(savePipTone('playful', blocked), 'playful');
});
