const APP_BASE_URL = 'https://org.uficonnect.app';
const MAX_PLAYERS = 8;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;
const KEY = /^[a-z0-9_-]{1,80}$/;
const CHANNEL = 'ufi-isolated-youtube-v1';
const EMPTY_STATE = Object.freeze({ playerState: -1, currentTime: 0, duration: 0, muted: true,
  volume: 100, playbackRate: 1, availablePlaybackRates: [1], videoId: '' });

function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid YouTube player value.');
  return value;
}
function videoId(value) {
  if (typeof value !== 'string' || !VIDEO_ID.test(value)) throw new Error('Invalid YouTube video.');
  return value;
}
function rect(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid YouTube player bounds.');
  const result = {};
  for (const key of ['x', 'y', 'clipX', 'clipY']) result[key] = number(value[key], -32768, 32768);
  for (const key of ['width', 'height', 'clipWidth', 'clipHeight']) result[key] = number(value[key], 0, 8192);
  for (const key of ['viewportWidth', 'viewportHeight']) result[key] = number(value[key], 1, 8192);
  if (typeof value.visible !== 'boolean') throw new Error('Invalid YouTube player visibility.');
  result.visible = value.visible;
  return result;
}
function playerVars(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid YouTube player settings.');
  const result = { origin: APP_BASE_URL, enablejsapi: 1, controls: 0, fs: 0, playsinline: 1, autoplay: 0, mute: 1, rel: 0 };
  for (const key of ['loop', 'cc_load_policy']) if (input[key] === 0 || input[key] === 1) result[key] = input[key];
  for (const key of ['start', 'end']) if (input[key] !== undefined) result[key] = number(input[key], 0, 604800);
  if (input.playlist !== undefined) result.playlist = videoId(input.playlist);
  if (typeof input.hl === 'string' && /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(input.hl)) result.hl = input.hl;
  return result;
}
function commands(input = []) {
  if (!Array.isArray(input) || input.length > 16) throw new Error('Too many YouTube player commands.');
  return input.map(command => {
    if (!command || typeof command !== 'object' || !Array.isArray(command.args || [])) throw new Error('Invalid YouTube player command.');
    const args = command.args || [];
    switch (command.name) {
      case 'playVideo': case 'pauseVideo': case 'stopVideo': case 'mute': case 'unMute':
        if (args.length) throw new Error('Invalid YouTube player command arguments.');
        return { name: command.name, args: [] };
      case 'seekTo':
        if (args.length < 1 || args.length > 2 || (args[1] !== undefined && typeof args[1] !== 'boolean')) throw new Error('Invalid YouTube seek.');
        return { name: command.name, args: [number(args[0], 0, 604800), args[1] !== false] };
      case 'setVolume': case 'setPlaybackRate':
        if (args.length !== 1) throw new Error('Invalid YouTube player command arguments.');
        return { name: command.name, args: [number(args[0], command.name === 'setVolume' ? 0 : 0.25, command.name === 'setVolume' ? 100 : 4)] };
      case 'loadVideoById': case 'cueVideoById': {
        if (args.length < 1 || args.length > 3) throw new Error('Invalid YouTube video arguments.');
        const object = args[0] && typeof args[0] === 'object';
        if (object && args.length !== 1) throw new Error('Invalid YouTube video arguments.');
        const id = videoId(object ? args[0].videoId : args[0]);
        const start = object ? args[0].startSeconds : args[1];
        const result = { videoId: id, startSeconds: start === undefined ? 0 : number(start, 0, 604800) };
        if (object && args[0].endSeconds !== undefined) result.endSeconds = number(args[0].endSeconds, 0, 604800);
        return { name: command.name, args: [result] };
      }
      default: throw new Error('Unsupported YouTube player command.');
    }
  });
}
function projectRect(value, size, active = true) {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return null;
  const scale = size.width / value.viewportWidth;
  const left = Math.max(0, value.x, value.clipX);
  const top = Math.max(0, value.y, value.clipY);
  const right = Math.min(value.viewportWidth, value.x + value.width, value.clipX + value.clipWidth);
  const bottom = Math.min(value.viewportHeight, size.height / scale, value.y + value.height, value.clipY + value.clipHeight);
  if (!active || !value.visible || right <= left || bottom <= top) return null;
  return { left: left * scale, top: top * scale, width: (right - left) * scale, height: (bottom - top) * scale,
    innerLeft: (value.x - left) * scale, innerTop: (value.y - top) * scale,
    innerWidth: value.width * scale, innerHeight: value.height * scale, scale };
}
function trustedMessageUrl(url) {
  return url === APP_BASE_URL || url === `${APP_BASE_URL}/`;
}
function allowNavigation(request) {
  if (!request || typeof request.url !== 'string') return false;
  if (trustedMessageUrl(request.url)) return request.navigationType !== 'click';
  if (request.isTopFrame !== false) return request.url === 'about:blank' && request.navigationType === 'other';
  if (request.url === 'about:blank') return true;
  try {
    const url = new URL(request.url);
    // The official player owns its HTTPS child frames (including consent and
    // advertising). They have no app capabilities and cannot send trusted
    // native messages. Lock the top document, not provider internals.
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
function playerState(value) {
  if (!value || typeof value !== 'object') throw new Error('Invalid YouTube player state.');
  const result = { playerState: number(value.playerState, -1, 5), currentTime: number(value.currentTime, 0, 604800),
    duration: number(value.duration, 0, 604800), volume: number(value.volume, 0, 100),
    playbackRate: number(value.playbackRate, 0.25, 4), videoId: videoId(value.videoId) };
  if (![-1, 0, 1, 2, 3, 5].includes(result.playerState) || typeof value.muted !== 'boolean'
    || !Array.isArray(value.availablePlaybackRates) || value.availablePlaybackRates.length > 16) throw new Error('Invalid YouTube player state.');
  result.muted = value.muted;
  result.availablePlaybackRates = value.availablePlaybackRates.map(rate => number(rate, 0.25, 4));
  return result;
}
function parsePlayerMessage(event) {
  if (!event || !trustedMessageUrl(event.url) || typeof event.data !== 'string' || event.data.length > 4096) return null;
  try {
    const value = JSON.parse(event.data);
    if (value.channel !== CHANNEL || !['snapshot', 'ready', 'state', 'error', 'rate', 'api'].includes(value.type)) return null;
    const result = { type: value.type, state: playerState(value.state) };
    if (value.type === 'error') result.data = number(value.data, 0, 10000);
    if (value.type === 'state') result.data = result.state.playerState;
    if (value.type === 'rate') result.data = result.state.playbackRate;
    return result;
  } catch { return null; }
}
function swipeEvent({ dx, dy, duration, fingers = 1 }, scale = 1) {
  if (fingers !== 1 || ![dx, dy, duration, scale].every(Number.isFinite) || scale <= 0 || duration < 0 || duration > 900
    || Math.max(Math.abs(dx), Math.abs(dy)) < 55 || Math.max(Math.abs(dx), Math.abs(dy)) > 8192) return null;
  return { type: 'swipe', data: { dx: dx / scale, dy: dy / scale, duration } };
}

function createPlayerRegistry({ changed = () => {}, send = () => {} } = {}) {
  const entries = new Map();
  let active = true;
  const canPlay = entry => active && entry.rect.visible && entry.rect.width > 0 && entry.rect.height > 0
    && entry.rect.clipWidth * entry.rect.clipHeight > entry.rect.width * entry.rect.height * 0.5;
  const enqueue = (entry, event) => { if (entries.get(entry.key) === entry) { entry.events.push(event); if (entry.events.length > 64) entry.events.shift(); } };
  const flush = entry => {
    if (!entry.ready) return;
    const visible = canPlay(entry), wasVisible = entry.playable;
    const pending = entry.commands.splice(0);
    const safe = [];
    for (const command of pending) {
      if (['playVideo', 'loadVideoById'].includes(command.name)) entry.wantsPlayback = true;
      if (['pauseVideo', 'stopVideo', 'cueVideoById'].includes(command.name)) entry.wantsPlayback = false;
      if (['loadVideoById', 'cueVideoById'].includes(command.name)) entry.requestedVideoId = command.args[0].videoId;
      if (!visible && command.name === 'playVideo') continue;
      if (!visible && command.name === 'loadVideoById') safe.push({ name: 'cueVideoById', args: command.args });
      else if (!visible && command.name === 'seekTo') safe.push({ name: 'cueVideoById', args: [{ videoId: entry.requestedVideoId, startSeconds: command.args[0] }] });
      else safe.push(command);
    }
    if (visible && !wasVisible && entry.wantsPlayback && !safe.some(command => ['playVideo', 'loadVideoById'].includes(command.name))) {
      safe.push({ name: 'playVideo', args: [] });
    }
    entry.playable = visible;
    if (visible && safe.some(command => ['playVideo', 'loadVideoById'].includes(command.name))) {
      for (const other of entries.values()) if (other !== entry && other.ready && other.wantsPlayback) {
        other.wantsPlayback = false;
        send(other, { channel: CHANNEL, sequence: ++other.sequence, active: canPlay(other), commands: [{ name: 'pauseVideo', args: [] }] });
      }
    }
    send(entry, { channel: CHANNEL, sequence: ++entry.sequence, active: visible,
      commands: visible ? safe : [...safe, { name: 'pauseVideo', args: [] }] });
  };
  return {
    entries,
    request(input) {
      if (!input || !KEY.test(input.key) || typeof input.key !== 'string' || !['mount', 'sync', 'destroy'].includes(input.op)) throw new Error('Invalid YouTube player request.');
      let entry = entries.get(input.key);
      if (input.op === 'destroy') {
        if (entry) { entry.commands = [{ name: 'stopVideo', args: [] }]; flush(entry); entries.delete(input.key); changed(); }
        return { events: [], state: { ...EMPTY_STATE } };
      }
      if (input.op === 'mount') {
        if (entry) throw new Error('YouTube player already exists.');
        if (entries.size >= MAX_PLAYERS) throw new Error('Too many active YouTube players.');
        const id = videoId(input.videoId);
        const settings = playerVars(input.playerVars);
        entry = { key: input.key, videoId: id, requestedVideoId: id, rect: rect(input.rect), playerVars: settings, ready: false, playable: false, wantsPlayback: false,
          events: [], commands: [], sequence: 0, state: { ...EMPTY_STATE, videoId: id }, webView: null };
        entry.html = makePlayerHtml(id, settings);
        entries.set(input.key, entry); changed();
      } else {
        if (!entry) throw new Error('YouTube player does not exist.');
        const nextRect = input.rect === undefined ? entry.rect : rect(input.rect);
        const nextCommands = commands(input.commands);
        if (JSON.stringify(nextRect) !== JSON.stringify(entry.rect)) { entry.rect = nextRect; changed(); }
        entry.commands.push(...nextCommands);
        if (entry.commands.length > 32) entry.commands.splice(0, entry.commands.length - 32);
        flush(entry);
      }
      return { events: entry.events.splice(0), state: { ...entry.state, availablePlaybackRates: [...entry.state.availablePlaybackRates] } };
    },
    receive(entry, event) {
      if (entries.get(entry.key) !== entry) return;
      const message = parsePlayerMessage(event);
      if (!message) return;
      entry.state = message.state;
      if (message.type !== 'snapshot') enqueue(entry, message.data === undefined ? { type: message.type } : { type: message.type, data: message.data });
      if (message.type === 'ready') { entry.ready = true; flush(entry); }
    },
    enqueue,
    setActive(value) { active = value === true; for (const entry of entries.values()) flush(entry); },
    dispose() { active = false; for (const entry of entries.values()) { entry.commands = [{ name: 'stopVideo', args: [] }]; flush(entry); } entries.clear(); },
  };
}

function makePlayerHtml(id, settings = {}) {
  const config = JSON.stringify({ videoId: videoId(id), playerVars: playerVars(settings), channel: CHANNEL }).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><style>html,body,#player{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}iframe{border:0}</style></head><body><div id="player"></div><script>
(function(){'use strict';var config=${config},player,ready=false,active=false,lastSequence=0;
function get(name,fallback){try{var value=player[name]();return value==null?fallback:value}catch(_){return fallback}}
function snapshot(){var info=get('getVideoData',{});return {playerState:get('getPlayerState',-1),currentTime:get('getCurrentTime',0),duration:get('getDuration',0),muted:get('isMuted',true),volume:get('getVolume',100),playbackRate:get('getPlaybackRate',1),availablePlaybackRates:get('getAvailablePlaybackRates',[1]),videoId:info.video_id||config.videoId}}
function emit(type,data){if(!window.ReactNativeWebView)return;window.ReactNativeWebView.postMessage(JSON.stringify({channel:config.channel,type:type,data:data,state:snapshot()}))}
function pause(){try{if(ready)player.pauseVideo()}catch(_){}}
function receive(event){if(event.source&&event.source!==window)return;if(typeof event.data!=='string'||event.data.length>8192)return;try{var msg=JSON.parse(event.data);if(msg.channel!==config.channel||!Number.isSafeInteger(msg.sequence)||msg.sequence<=lastSequence||typeof msg.active!=='boolean'||!Array.isArray(msg.commands)||msg.commands.length>33)return;lastSequence=msg.sequence;active=msg.active;if(!ready)return;msg.commands.forEach(function(command){if(!command||!Array.isArray(command.args))return;var name=command.name;if(['playVideo','pauseVideo','stopVideo','seekTo','mute','unMute','setVolume','setPlaybackRate','loadVideoById','cueVideoById'].indexOf(name)<0)return;if(!active&&(name==='playVideo'||name==='loadVideoById'))return;try{player[name].apply(player,command.args)}catch(_){}});if(!active)pause();emit('snapshot')}catch(_){}}
window.addEventListener('message',receive);document.addEventListener('message',receive);
document.addEventListener('visibilitychange',function(){if(document.hidden){active=false;pause()}});
window.addEventListener('pagehide',function(){active=false;pause();try{if(player)player.destroy()}catch(_){}});
window.onYouTubeIframeAPIReady=function(){player=new YT.Player('player',{videoId:config.videoId,playerVars:config.playerVars,events:{onReady:function(){ready=true;player.mute();pause();emit('ready')},onStateChange:function(event){if(!active&&event.data===1)pause();emit('state',event.data)},onError:function(event){emit('error',event.data)},onPlaybackRateChange:function(event){emit('rate',event.data)},onApiChange:function(){emit('api')}}})};
setInterval(function(){if(ready)emit('snapshot')},400);
var script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.onerror=function(){emit('error',5)};document.head.appendChild(script);
})();</script></body></html>`;
}

module.exports = { APP_BASE_URL, MAX_PLAYERS, CHANNEL, EMPTY_STATE, commands, playerVars, rect, projectRect,
  trustedMessageUrl, allowNavigation, parsePlayerMessage, swipeEvent, createPlayerRegistry, makePlayerHtml };
