import test from 'node:test';
import assert from 'node:assert/strict';
import { configureNativeRuntime } from './nativeRuntime.mjs';
import { openNativeTwitchPlayer } from './nativeTwitchPlayer.mjs';

test('Twitch playback stays in the dedicated native player and passes only public attribution', async () => {
  const requests=[];
  configureNativeRuntime({nativePlatform:'ios',onApiRequest:async()=>{},onOpenExternal:async()=>{throw Error('External browser must not open');},onTwitchPlayer:async r=>{requests.push(r);return{opened:true};}});
  try {
    assert.deepEqual(await openNativeTwitchPlayer({url:'https://www.twitch.tv/creator/clip/GoodClip-Ab12?tracking=discard',title:'A clip\n',creator:'Creator',token:'private'}),{opened:true});
    assert.deepEqual(requests,[{url:'https://clips.twitch.tv/GoodClip-Ab12',title:'A clip',creator:'Creator'}]);
    for(const url of ['https://evil.example/GoodClip','https://clips.twitch.tv.evil.example/GoodClip','http://clips.twitch.tv/GoodClip','https://clips.twitch.tv/embed?clip=GoodClip','https://user:pass@clips.twitch.tv/GoodClip','javascript:alert(1)'])await assert.rejects(openNativeTwitchPlayer({url}),/unavailable/);
    assert.equal(requests.length,1);
  } finally {configureNativeRuntime(null);}
});

test('Older native hosts report an update requirement without launching an external browser', async () => {
  configureNativeRuntime({nativePlatform:'ios',onApiRequest:async()=>{},onOpenExternal:async()=>{assert.fail('Must stay in UFIconnect');}});
  try {await assert.rejects(openNativeTwitchPlayer({url:'https://clips.twitch.tv/GoodClip'}),/Update UFIconnect/);}finally{configureNativeRuntime(null);}
});
