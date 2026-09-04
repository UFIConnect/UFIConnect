'use strict';

const RELATED_TERM_GROUPS = [
  ['job', 'jobs', 'career', 'careers', 'hiring', 'hire', 'employment', 'opportunity', 'opportunities', 'role', 'roles'],
  ['developer', 'developers', 'development', 'engineer', 'engineers', 'engineering', 'programmer', 'programmers', 'programming', 'coder', 'coding', 'software'],
  ['design', 'designer', 'designers', 'ui', 'ux', 'creative'],
  ['travel', 'trip', 'trips', 'vacation', 'vacations', 'tourism', 'destination', 'destinations'],
  ['restaurant', 'restaurants', 'dining', 'food', 'eatery', 'eateries'],
  ['founder', 'founders', 'startup', 'startups', 'entrepreneur', 'entrepreneurs'],
  ['recruiter', 'recruiters', 'recruiting', 'talent', 'hiring'],
  ['resume', 'resumes', 'cv', 'cvs'],
  ['article', 'articles', 'news', 'story', 'stories'],
  ['video', 'videos', 'clip', 'clips', 'media'],
  ['c++', 'cpp'],
  ['c#', 'csharp'],
  ['r', 'rstats'],
];

const RELATED_BY_TERM = new Map();
for (const group of RELATED_TERM_GROUPS) {
  for (const term of group) {
    const related = RELATED_BY_TERM.get(term) || new Set();
    group.forEach(candidate => related.add(candidate));
    RELATED_BY_TERM.set(term, related);
  }
}

function splitSearchWords(value, limit = 12) {
  const normalized = String(value || '').normalize('NFKC').toLowerCase();
  const words = normalized.match(/[\p{L}\p{N}][\p{L}\p{N}+#]*/gu) || [];
  return [...new Set(words)].slice(0, limit);
}

function expandSearchWords(value, limit = 40) {
  const requested = splitSearchWords(value);
  const expanded = new Set(requested);
  for (const word of requested) {
    for (const related of RELATED_BY_TERM.get(word) || []) expanded.add(related);
  }
  return [...expanded].slice(0, limit);
}

function databaseSearchTerms(value) {
  const terms = expandSearchWords(value);
  const lexemes = [...new Set(terms.flatMap(term => (
    term.match(/[\p{L}\p{N}]+/gu) || []
  )))].filter(term => term.length > 1);
  return {
    terms,
    webQuery: lexemes.map(term => `"${term}"`).join(' OR '),
    prefixQuery: lexemes.map(term => `${term}:*`).join(' | '),
  };
}

function matchesRelatedSearch(text, value) {
  const query = String(value || '').normalize('NFKC').toLowerCase().trim();
  if (!query) return true;
  const terms = expandSearchWords(query);
  if (!terms.length) return false;
  const haystack = String(text || '').normalize('NFKC').toLowerCase();
  const words = splitSearchWords(haystack, 5000);
  return terms.some((term) => {
    if (term.length < 3) return words.includes(term);
    if (haystack.includes(term)) return true;
    const prefixLength = Math.min(5, term.length);
    const prefix = term.slice(0, prefixLength);
    return words.some(word => word.length >= prefixLength && word.startsWith(prefix));
  });
}

function relatedSearchScore(text, value) {
  const query = String(value || '').normalize('NFKC').toLowerCase().trim();
  if (!query) return 0;
  const haystack = String(text || '').normalize('NFKC').toLowerCase();
  const requested = splitSearchWords(query);
  const expanded = expandSearchWords(query);
  let score = haystack.includes(query) ? 100 : 0;
  score += requested.filter(term => term.length < 3
    ? splitSearchWords(haystack, 5000).includes(term)
    : haystack.includes(term)).length * 20;
  score += expanded.filter(term => !requested.includes(term) && haystack.includes(term)).length * 5;
  return score;
}

module.exports = {
  databaseSearchTerms,
  expandSearchWords,
  matchesRelatedSearch,
  relatedSearchScore,
  splitSearchWords,
};
