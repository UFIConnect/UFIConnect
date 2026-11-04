export const MAX_ATTACHMENTS = 4;
export const ATTACHMENT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf,text/*,application/json,.md,.csv,.log,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml';
export async function imageAttachment(source, name = 'photo.jpg', environment = globalThis) {
  const bitmap = await environment.createImageBitmap(source);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = environment.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .82);
    if (data.length > 690000) data = canvas.toDataURL('image/jpeg', .55);
    if (data.length > 690000) throw Error('This photo is too large. Choose a smaller image.');
    return { name: name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', data };
  } finally { bitmap.close(); }
}
export async function readOfficeAttachment(file, environment = globalThis) {
  if (/^image\/(?:jpeg|png|webp)$/.test(file.type)) return imageAttachment(file, file.name, environment);
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 1024 * 1024) throw Error('PDFs must be 1 MB or smaller.');
    const data = await new Promise((resolve, reject) => { const reader = new environment.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error('The file could not be read.')); reader.readAsDataURL(file); });
    return { name: file.name, type: 'application/pdf', data: String(data).replace(/^data:[^;,]*;/, 'data:application/pdf;') };
  }
  if (!file.type.startsWith('text/') && file.type !== 'application/json' && !/\.(?:txt|md|csv|log|json|js|jsx|ts|tsx|css|html|xml|ya?ml)$/i.test(file.name)) throw Error('Choose a JPEG, PNG, WebP, PDF, or text file.');
  if (file.size > 100 * 1024) throw Error('Text files must be 100 KB or smaller.');
  return { name: file.name, type: file.type.startsWith('text/') || file.type === 'application/json' ? file.type : 'text/plain', data: await file.text() };
}
