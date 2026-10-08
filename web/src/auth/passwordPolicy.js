export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;
export const PASSWORD_GUIDANCE = 'Use at least 12 characters. A unique passphrase works well. Maximum 72 bytes; some characters use more than one byte.';

export function validateNewPassword(password) {
  if (Array.from(password || '').length < PASSWORD_MIN_LENGTH) {
    return 'Use at least 12 characters for your new password.';
  }
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return 'Password must be 72 UTF-8 bytes or fewer. Some characters use more than one byte.';
  }
  return '';
}
