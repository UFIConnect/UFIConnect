'use strict';

const crypto = require('node:crypto');
const corpus = require('./security-data/common-passwords.json');
const hashes = new Set(corpus.hashes);
const message = 'This password is too common or predictable. Choose a unique passphrase with unrelated words.';
const sequences = ['0123456789', '1234567890', '9876543210', '0987654321', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'qwertyuiopasdfghjklzxcvbnm', 'password', 'password1', 'letmein'];

function passwordBlocklistError(value) {
  if (typeof value !== 'string') return null; // Length/type validation belongs to passwordPolicyError.
  // Compare whole candidates only. Normalization is limited to this check:
  // it must never change the credential passed to bcrypt or accepted at login.
  const candidate = value.normalize('NFKC').toLowerCase();
  const fingerprint = crypto.createHash('sha256').update(candidate, 'utf8').digest('hex');
  if (hashes.has(fingerprint)) return message;
  if (/^(.{1,4})\1+$/u.test(candidate)) return message;
  if (sequences.some(sequence => sequence.repeat(Math.ceil(candidate.length / sequence.length)).slice(0, candidate.length) === candidate)) return message;
  if (/^(?:uficonnect|proconnect)(?:[\d!@#$%^&*._-]|password)*$/u.test(candidate)) return message;
  return null;
}

module.exports = { passwordBlocklistError };
