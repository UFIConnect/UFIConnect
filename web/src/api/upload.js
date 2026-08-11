import client from './client';

// Direct-to-Cloudinary upload: the backend only ever hands out a short-lived
// signed signature (GET /media/upload-signature) — the file itself never
// passes through our own Express server, so a large video doesn't tie up a
// Render instance's bandwidth/memory. XHR (not fetch) specifically so we can
// report upload progress.
export function uploadMedia(file, onProgress) {
  return client.get('/media/upload-signature').then(({ data: sig }) => new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', sig.timestamp);
    form.append('signature', sig.signature);
    form.append('folder', sig.folder);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`);
    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          resolve({ url: result.secure_url, type: result.resource_type === 'video' ? 'video' : 'image' });
        } catch {
          reject(new Error('Unexpected upload response'));
        }
      } else {
        // Cloudinary's own error responses are JSON with a real message
        // (e.g. "File size too large", "Invalid signature") — surfacing
        // that instead of a flat "Upload failed" is the difference between
        // the user knowing what actually went wrong and just retrying blind.
        let message = 'Upload failed';
        try { message = JSON.parse(xhr.responseText)?.error?.message || message; } catch { /* not JSON */ }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(form);
  }));
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB — Cloudinary free tier's per-file cap
