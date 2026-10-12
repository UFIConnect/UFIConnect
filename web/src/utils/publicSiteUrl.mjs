// Public links must keep working when copied from a native file document or
// an isolated browser preview. Neither is a public destination for recipients.
export const PUBLIC_SITE_ORIGIN = 'https://uficonnect.org';

export function publicSiteUrl(path) {
  const url = new URL(path, PUBLIC_SITE_ORIGIN);
  if (url.origin !== PUBLIC_SITE_ORIGIN || url.username || url.password) {
    throw new TypeError('Public UFIConnect links must use the public website.');
  }
  return url.href;
}
