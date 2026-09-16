function attachmentDetails(file) {
  if (!file || typeof file.name !== 'string' || !file.name.trim()) {
    throw new Error('No file was selected.');
  }
  // This screen shares metadata, not uploaded file contents. Never transmit
  // device-local URIs, browser data/blob URLs, or the picker File object.
  return {
    name: file.name,
    size: Number.isFinite(file.size) && file.size >= 0 ? file.size : null,
    mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
  };
}

module.exports = { attachmentDetails };
