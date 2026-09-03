const DEFAULT_RECENCY_COHORT_MS = 60 * 1000;

export function orderNewestFeedCohorts(posts = [], cohortMs = DEFAULT_RECENCY_COHORT_MS) {
  const cohorts = new Map();
  for (const post of posts) {
    const timestamp = new Date(post?.createdAt || 0).getTime();
    const cohort = Math.floor((Number.isFinite(timestamp) ? timestamp : 0) / cohortMs);
    if (!cohorts.has(cohort)) cohorts.set(cohort, []);
    cohorts.get(cohort).push(post);
  }
  return [...cohorts.entries()]
    .sort(([left], [right]) => right - left)
    .flatMap(([, cohort]) => cohort);
}

