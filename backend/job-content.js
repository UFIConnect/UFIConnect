const { isCareerListing } = require('./job-sources.mjs');
const { careerHeadingKind } = require('./job-sections.mjs');
const { SOURCE_CONTENT_MAX_CHARS } = require('./source-post-content');
const { mastodonContentText } = require('./mastodon-content');
const JOB_CONTENT_MAX_CHARS = SOURCE_CONTENT_MAX_CHARS;
function importedContentLimit(post) {
  if (post?.source === 'uficonnect' || post?.isExternal === false) return isCareerListing(post) ? 60000 : 2000;
  return SOURCE_CONTENT_MAX_CHARS;
}
function jobDescriptionText(html, decode = value => value) {
  return mastodonContentText(decode(String(html || '').slice(0, 1_000_000))
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, body) => careerHeadingKind(body.replace(/<[^>]*>/g, '')) ? `\n${body}\n` : body)
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/?(?:p|div|ul|ol|h[1-6]|section|br)\b[^>]*>/gi, '\n'), JOB_CONTENT_MAX_CHARS);
}
function usaJobsDescription(descriptor, decode = value => value) {
  const detail = descriptor?.UserArea?.Details || {};
  const duties = [].concat(detail.MajorDuties || []).filter(value => typeof value === 'string' && value.trim());
  return jobDescriptionText([
    detail.JobSummary && `Job summary\n${detail.JobSummary}`,
    duties.length && `Major duties\n${duties.join('\n')}`,
    descriptor?.QualificationSummary && `Qualifications\n${descriptor.QualificationSummary}`,
  ].filter(Boolean).join('\n\n') || descriptor?.PositionTitle || '', decode);
}
module.exports = { JOB_CONTENT_MAX_CHARS, importedContentLimit, jobDescriptionText, usaJobsDescription };
