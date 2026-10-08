export const MESSAGE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export const MESSAGE_VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
export const MESSAGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const MESSAGE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

export function messageFileError(file) {
  const video = MESSAGE_VIDEO_TYPES.has(file?.type);
  if (!video && !MESSAGE_IMAGE_TYPES.has(file?.type)) return 'Choose a JPEG, PNG, WebP or GIF photo, or an MP4, WebM or MOV video.';
  const max = video ? MESSAGE_VIDEO_MAX_BYTES : MESSAGE_IMAGE_MAX_BYTES;
  return !Number.isSafeInteger(file.size) || file.size <= 0 ? 'Choose a file that contains a photo or video.'
    : file.size > max ? `Choose a ${video ? 'video smaller than 100 MB' : 'photo smaller than 10 MB'}.` : '';
}

export function messageAttachmentPath(attachment, userId, messageId) {
  if (!['image', 'video'].includes(attachment?.type) || !userId || !messageId) return null;
  const expected = `/messages/${encodeURIComponent(userId)}/attachments/${encodeURIComponent(messageId)}`;
  return attachment.accessPath === expected ? expected : null;
}

export function legacyMessageUrl(attachment) {
  if (!attachment?.legacy || !['image', 'video'].includes(attachment.type) || typeof attachment.url !== 'string') return null;
  try {
    const url = new URL(attachment.url);
    return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.port && !url.username && !url.password
      && !url.search && !url.hash && /^\/[a-zA-Z0-9_-]+\/(?:image|video)\/upload\//.test(url.pathname)
      && url.pathname.includes('/uficonnect-messages/') && /\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i.test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

export function messageBlobError(blob, type) {
  const accepted = type === 'image' ? MESSAGE_IMAGE_TYPES : type === 'video' ? MESSAGE_VIDEO_TYPES : null;
  const max = type === 'image' ? MESSAGE_IMAGE_MAX_BYTES : MESSAGE_VIDEO_MAX_BYTES;
  return !accepted?.has(blob?.type) || !Number.isSafeInteger(blob?.size) || blob.size <= 0 || blob.size > max
    ? 'This attachment could not be loaded safely.' : '';
}

// A navigation or account change cancels every outstanding read/send/upload.
// Check this again after promises settle before using returned private data.
export function createMessageRequestScope() {
  const controller = new AbortController();
  return { signal: controller.signal, isCurrent: () => !controller.signal.aborted, close: () => controller.abort() };
}
