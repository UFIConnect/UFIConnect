import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraVoiceCommand } from './snapCameraCommands.mjs';

test('camera commands recognize only deliberate final camera phrases', () => {
  for (const [phrase, action] of [['Take a photo.', 'photo'], ['UFI, please switch camera', 'switch'], ['invert camera', 'mirror'], ['start recording', 'record'], ['pause recording', 'pause'], ['resume recording', 'resume'], ['stop recording', 'stop'], ['three second timer', 'timerThree'], ['stop listening', 'stopListening']]) assert.equal(cameraVoiceCommand(phrase), action, phrase);
});
test('camera commands ignore negation, partial phrases, publication, and unrelated speech', () => {
  for (const phrase of [null, '', 'take', 'do not take photo', "don't start recording", 'maybe take photo later', 'publish snap', 'post snap', 'delete my account', 'pay for Pro', 'take photo and post it', 'a'.repeat(101)]) assert.equal(cameraVoiceCommand(phrase), null, String(phrase));
});
