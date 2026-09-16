const AUTH_PATH = /(?:^|\/)(?:login|register|forgot-password|reset-password|callback)(?:\/|$)/i;

export function telemetryPath(value) {
  try {
    const path = new URL(value || '/', 'https://uficonnect.org').pathname;
    return AUTH_PATH.test(path) ? null : path;
  } catch { return null; }
}

export function redactTelemetry(value, maxLength = 2000) {
  if (value == null) return null;
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted token]')
    .replace(/([?&](?:token|code|password|key|secret|access_token|refresh_token|id_token)=)[^\s&#"']*/gi, '$1[redacted]')
    .replace(/((?:password|currentPassword|newPassword|confirmPassword|accessToken|refreshToken|clientSecret)["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[\s\S])*?\2/gi, '$1"[redacted]"')
    .replace(/((?:password|currentPassword|newPassword|confirmPassword|accessToken|refreshToken|clientSecret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redacted]')
    .slice(0, maxLength);
}
