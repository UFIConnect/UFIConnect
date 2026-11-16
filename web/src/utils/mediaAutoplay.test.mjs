import test from 'node:test';
import assert from 'node:assert/strict';
import { playMedia, playVimeo } from './mediaAutoplay.mjs';
test('autoplay requests sound before play and preserves an explicit mute', async () => {
  const states=[]; const video={volume:1,play(){states.push(this.muted);return Promise.resolve();}};
  assert.equal(await playMedia(video),true);
  assert.equal(await playMedia(video,{muted:true}),true);
  assert.deepEqual(states,[false,true]);
});
test('audio policy rejection falls back once to muted playback',async()=>{
  const states=[];const video={volume:1,play(){states.push(this.muted);return this.muted?Promise.resolve():Promise.reject(new DOMException('Audio requires interaction','NotAllowedError'));}};
  assert.equal(await playMedia(video),true);assert.deepEqual(states,[false,true]);
});
test('a stale or explicitly paused request cannot retry after policy rejection',async()=>{
  let reject,valid=true,calls=0;const video={volume:1,play(){calls++;return new Promise((_,fail)=>{reject=fail;});}};
  const result=playMedia(video,{isCurrent:()=>valid});valid=false;reject(new DOMException('Blocked','NotAllowedError'));
  assert.equal(await result,false);assert.equal(calls,1);
});
test('loading interruptions and media failures never trigger a silent retry',async()=>{
  for(const name of ['AbortError','NotSupportedError']){let calls=0;const video={volume:1,play(){calls++;return Promise.reject(new DOMException('Failed',name));}};assert.equal(await playMedia(video),false);assert.equal(calls,1);}
});
test('Vimeo retries a rejected audio play request once with mute',async()=>{
  const calls=[];let muted=false;const controller={async call(method,value){calls.push([method,value]);if(method==='setMuted')muted=value;if(method==='play'&&!muted)throw new DOMException('Blocked','NotAllowedError');}};
  assert.equal(await playVimeo(controller),true);
  assert.deepEqual(calls,[['setMuted',false],['play',undefined],['setMuted',true],['play',undefined]]);
});
test('Vimeo does not restart after Pause while a command is pending',async()=>{
  let current=true,finish;const calls=[];const controller={call(method){calls.push(method);return new Promise(resolve=>{finish=resolve;});}};
  const result=playVimeo(controller,{isCurrent:()=>current});current=false;finish();
  assert.equal(await result,false);assert.deepEqual(calls,['setMuted']);
});

test('Vimeo reports deferral when eligibility changes before the first play call', async () => {
  const mute = Promise.withResolvers();
  const calls = [];
  let eligible = true;
  let deferrals = 0;
  const controller = {
    call(method) {
      calls.push(method);
      return mute.promise;
    },
  };
  const start = playVimeo(controller, {
    isCurrent: () => eligible,
    onStartDeferred: () => { deferrals++; },
  });
  eligible = false;
  mute.resolve();
  assert.equal(await start, false);
  assert.equal(deferrals, 1);
  assert.deepEqual(calls, ['setMuted']);
});

test('Vimeo provider failures do not defer a startup', async () => {
  for (const failMethod of ['setMuted', 'play']) {
    const calls = [];
    let deferrals = 0;
    const controller = {
      async call(method) {
        calls.push(method);
        if (method === failMethod) throw new DOMException('Provider refused the action', 'PrivacyError');
      },
    };
    assert.equal(await playVimeo(controller, { onStartDeferred: () => { deferrals++; } }), false);
    assert.equal(deferrals, 0);
    assert.deepEqual(calls, failMethod === 'setMuted' ? ['setMuted'] : ['setMuted', 'play']);
  }
});
