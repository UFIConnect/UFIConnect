'use strict';

const { JOB_SOURCE_IDS } = require('./job-sources.mjs');
const JOB_SOURCES = new Set(JOB_SOURCE_IDS);

function jobPostedDate(value, now = Date.now()) {
  if (value == null || value === '') return null;
  let input = value;
  if (typeof input === 'number' || /^\d+(\.\d+)?$/.test(String(input))) {
    input = Number(input);
    if (input < 10000000000) input *= 1000;
  } else if (typeof input === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(input)) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const ms = new Date(input).getTime();
  // A missing or future publication date is not the time we imported it.
  return Number.isFinite(ms) && ms > 0 && ms <= now ? new Date(ms).toISOString() : null;
}

module.exports = { JOB_SOURCES, jobPostedDate };
