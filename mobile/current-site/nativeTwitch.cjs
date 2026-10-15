const TWITCH_WRAPPER = 'https://uficonnect.org/twitch-player.html';
const CLIP = /^[A-Za-z0-9_-]{1,140}$/;

function clipRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.url !== 'string') throw new Error('Choose a valid Twitch clip.');
  const match = input.url.match(/^https:\/\/clips\.twitch\.tv\/([A-Za-z0-9_-]{1,140})$/);
  if (!match || !CLIP.test(match[1]) || ['embed', 'create'].includes(match[1])) throw new Error('Choose a valid Twitch clip.');
  const label = (value, limit) => {
    if (value == null) return '';
    if (typeof value !== 'string') throw new Error('Invalid Twitch clip details.');
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
  };
  return { clip: match[1], originalUrl: input.url, wrapperUrl: `${TWITCH_WRAPPER}?clip=${match[1]}`,
    title: label(input.title, 200) || 'Twitch clip', creator: label(input.creator, 80) };
}

function twitchPageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return null;
  const match = value.match(/^https:\/\/([a-z0-9.-]+)(?:\/[^]*)?$/i);
  if (!match || !(match[1] === 'twitch.tv' || match[1].endsWith('.twitch.tv'))) return null;
  return value;
}

function allowTwitchNavigation(request, player) {
  if (!request || !player) return false;
  if (request.url === player.wrapperUrl || twitchPageUrl(request.url)) return true;
  if (request.isTopFrame !== false) return false;
  if (request.url === 'about:blank') return true;
  // The official player owns its HTTPS ad/consent frames. These have no app
  // capability or session headers; top-level navigation remains bounded above.
  const value = request.url;
  if (typeof value !== 'string' || value.length > 8192 || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  const match = value.match(/^https:\/\/([a-z0-9.-]+)(?::443)?(?:[/?#][^]*)?$/i);
  return !!match && match[1].length <= 253 && match[1].split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
}

module.exports = { TWITCH_WRAPPER, clipRequest, twitchPageUrl, allowTwitchNavigation };
