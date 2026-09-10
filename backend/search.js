'use strict';

const RELATED_TERM_GROUPS = [
  ['job', 'jobs', 'career', 'careers', 'hiring', 'hire', 'employment', 'opportunity', 'opportunities', 'role', 'roles'],
  ['developer', 'developers', 'development', 'engineer', 'engineers', 'engineering', 'programmer', 'programmers', 'programming', 'coder', 'coding'],
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
const QUERY_STOP_WORDS = new Set('a an and are as at be by find for from how i in is it me near of on or our the their to was we what when where which who with you your'.split(' '));
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
  const requested = searchTermGroups(value).map(group => group[0]);
  const expanded = new Set(requested);
  for (const word of requested) {
    for (const related of RELATED_BY_TERM.get(word) || []) expanded.add(related);
  }
  return [...expanded].slice(0, limit);
}

function searchTermGroups(value, { preserveStopWords = false } = {}) {
  const words = splitSearchWords(value, 100).filter(word => preserveStopWords || !QUERY_STOP_WORDS.has(word)).slice(0, 12);
  return words.map(word => [...new Set([word, ...(RELATED_BY_TERM.get(word) || [])])]);
}

function matchesTerm(words, term) {
  return words.some(word => term.length < 3 ? word === term : word.startsWith(term));
}

function databaseSearchTerms(value) {
  const groups = searchTermGroups(value);
  const terms = [...new Set(groups.flat())];
  const lexemes = group => [...new Set(group.flatMap(term => term.match(/[\p{L}\p{N}]+/gu) || []))];
  return {
    terms,
    webQuery: groups.map(group => `"${group[0]}"`).join(' '),
    prefixQuery: groups.map(group => `(${lexemes(group).map(term => term.length < 3 ? term : `${term}:*`).join(' | ')})`).join(' & '),
  };
}

function matchesRelatedSearch(text, value) {
  const query = String(value || '').normalize('NFKC').toLowerCase().trim();
  if (!query) return true;
  const groups = searchTermGroups(query);
  if (!groups.length) return false;
  const haystack = String(text || '').normalize('NFKC').toLowerCase();
  const words = splitSearchWords(haystack, 5000);
  return groups.every(group => group.some(term => matchesTerm(words, term)));
}

function relatedSearchScore(text, value) {
  const query = String(value || '').normalize('NFKC').toLowerCase().trim();
  if (!query) return 0;
  const haystack = String(text || '').normalize('NFKC').toLowerCase();
  const requested = searchTermGroups(query).map(group => group[0]);
  const expanded = expandSearchWords(query);
  const words = splitSearchWords(haystack, 5000);
  let score = haystack.includes(query) ? 100 : 0;
  score += requested.filter(term => matchesTerm(words, term)).length * 20;
  score += expanded.filter(term => !requested.includes(term) && matchesTerm(words, term)).length * 5;
  return score;
}

module.exports = {
  databaseSearchTerms,
  expandSearchWords,
  matchesRelatedSearch,
  relatedSearchScore,
  searchTermGroups,
  splitSearchWords,
};
