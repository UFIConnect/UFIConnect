import directory from './account-directory.json' with { type: 'json' };

export const normalizeCareerSource = value => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
const careers = Object.entries(directory).filter(([, entry]) => entry.category === 'career');
export const JOB_SOURCE_IDS = [...new Set([...careers.map(([key]) => key), 'themuse'])];
const careerNames = new Set([...JOB_SOURCE_IDS, ...careers.map(([, entry]) => entry.name)].map(normalizeCareerSource));
export function isCareerListing(post) {
  return post?.type === 'job' || post?.postType === 'job'
    || (post?.source === 'uficonnect' && post?.sourceLabel === 'Hiring')
    || careerNames.has(normalizeCareerSource(post?.source))
    || careerNames.has(normalizeCareerSource(post?.sourceLabel));
}
