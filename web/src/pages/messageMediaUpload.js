import client from '../api/client';
import { messageFileError, MESSAGE_VIDEO_TYPES } from './messageSecurity.mjs';

export async function uploadMessageMedia(file, onProgress, signal) {
  const fileError = messageFileError(file);
  if (fileError) throw new Error(fileError);
  const { data: sig } = await client.get('/media/upload-signature', { params: { folder: 'messages' }, signal });
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  if (sig.deliveryType !== 'authenticated' || sig.folder !== 'uficonnect-messages' || sig.overwrite !== false
      || !/^[a-zA-Z0-9_-]+$/.test(sig.cloudName || '') || typeof sig.publicId !== 'string') {
    throw new Error('Private message uploads are unavailable. Try again shortly.');
  }
  const type = MESSAGE_VIDEO_TYPES.has(file.type) ? 'video' : 'image';
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', sig.timestamp);
    form.append('signature', sig.signature);
    form.append('folder', sig.folder);
    form.append('public_id', sig.publicId);
    form.append('type', sig.deliveryType);
    form.append('overwrite', 'false');
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = handler => value => { signal?.removeEventListener('abort', abort); handler(value); };
    const fail = finish(reject);
    const succeed = finish(resolve);
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${type}/upload`);
    xhr.timeout = 120000;
    xhr.upload.onprogress = event => {
      if (onProgress && event.lengthComputable && !signal?.aborted) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300 || result.resource_type !== type || result.type !== 'authenticated') {
          throw new Error('Private attachment upload failed. Try again.');
        }
        succeed({ url: result.secure_url, type,
          upload: { publicId: result.public_id, version: result.version, signature: result.signature } });
      } catch (error) { fail(error); }
    };
    xhr.onerror = () => fail(new Error('Attachment upload failed. Try again.'));
    xhr.ontimeout = () => fail(new Error('Attachment upload timed out. Try again.'));
    xhr.onabort = () => fail(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { fail(new DOMException('Upload cancelled', 'AbortError')); return; }
    xhr.send(form);
  });
}
