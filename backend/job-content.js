const { JOB_SOURCES } = require('./job-dates');
const JOB_CONTENT_MAX_CHARS = 60000;
function importedContentLimit(post) {
  return JOB_SOURCES.has(String(post?.source || '').toLowerCase()) ? JOB_CONTENT_MAX_CHARS : 2000;
}
function jobDescriptionText(html, decode = value => value) {
  return decode(String(html || '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ''))
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:p|div|ul|ol|h[1-6]|section|br)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, JOB_CONTENT_MAX_CHARS);
}
module.exports = { JOB_CONTENT_MAX_CHARS, importedContentLimit, jobDescriptionText };
