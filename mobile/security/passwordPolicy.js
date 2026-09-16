const MIN_PASSWORD_CHARACTERS = 15;
const MAX_PASSWORD_BYTES = 72;

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function validateNewPassword(password) {
  if (typeof password !== 'string' || [...password].length < MIN_PASSWORD_CHARACTERS) {
    return 'Use at least 15 characters. A unique passphrase works well.';
  }
  if (utf8ByteLength(password) > MAX_PASSWORD_BYTES) {
    return 'Use no more than 72 UTF-8 bytes. Some symbols count as more than one byte.';
  }
  return '';
}

module.exports = { validateNewPassword, utf8ByteLength };
