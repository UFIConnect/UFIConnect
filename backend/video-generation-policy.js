const MIN_VIDEO_SECONDS = 4;
const MAX_VIDEO_SECONDS = 300;
const PLANNED_MAX_VIDEO_SECONDS = 1800;

function videoDurationSeconds(value, fallback = 12) {
  const candidate = value === undefined ? fallback : value;
  const seconds = typeof candidate === 'number' ? candidate
    : typeof candidate === 'string' && /^\d+$/.test(candidate) ? Number(candidate) : NaN;
  if (!Number.isSafeInteger(seconds) || seconds < MIN_VIDEO_SECONDS) {
    throw Object.assign(new Error('Choose a whole-number video duration of at least 4 seconds.'), { status: 400 });
  }
  if (seconds > MAX_VIDEO_SECONDS) {
    throw Object.assign(new Error('Videos longer than 5 minutes are locked. Support up to 30 minutes is planned.'), { status: 400 });
  }
  return seconds;
}

module.exports = { MIN_VIDEO_SECONDS, MAX_VIDEO_SECONDS, PLANNED_MAX_VIDEO_SECONDS, videoDurationSeconds };
