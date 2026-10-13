const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createCommentCache}=require('./comment-cache');
function fixture(){
  const storage=new Map();
  const cache=createCommentCache({getCached:key=>storage.get(key)?.value,setCached:(key,value,ttl)=>storage.set(key,{value,ttl}),deleteCached:key=>storage.delete(key),
    screenComment:comment=>({allowed:comment.body!=='unsafe',comment}),ttlMs:30000});
  return {cache,storage};
}
const post={source:'reddit',sourceUrl:'https://www.reddit.com/r/test/comments/abc/title',viewerId:'member'};
test('simultaneous readers share one screened list and paginate truthful counts',async()=>{
  const {cache}=fixture();let calls=0,resolve;
  const loader=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const first=cache.read('comments_reddit_abc',loader,0,1,post),second=cache.read('comments_reddit_abc',loader,1,1,post);
  await Promise.resolve();resolve([{id:'a',body:'safe'},{id:'b',body:'unsafe'},{id:'c',body:'safe'}]);
  assert.deepEqual(await first,{comments:[{id:'a',body:'safe'}],hasMore:true,total:2});
  assert.deepEqual(await second,{comments:[{id:'c',body:'safe'}],hasMore:false,total:2});assert.equal(calls,1);
});
test('confirmed writes invalidate aliases and viewer scopes without clearing other posts',async()=>{
  const {cache}=fixture();let calls=0;
  const loader=async()=>[{id:String(++calls),body:'safe'}];
  await cache.read('public-id',loader,0,20,post);
  await cache.read('own-id',loader,0,20,{...post,viewerId:'other'});
  await cache.read('unrelated',loader,0,20,{...post,sourceUrl:'https://www.reddit.com/r/test/comments/other/title'});
  cache.invalidate({...post,sourceUrl:post.sourceUrl+'?tracking=ignored'});
  await cache.read('public-id',loader,0,20,post);await cache.read('own-id',loader,0,20,{...post,viewerId:'other'});
  await cache.read('unrelated',loader,0,20,{...post,sourceUrl:'https://www.reddit.com/r/test/comments/other/title'});
  assert.equal(calls,5);
});
test('a read finishing after publication cannot repopulate an invalidated cache',async()=>{
  const {cache,storage}=fixture();let resolve;
  const stale=cache.read('id',()=>new Promise(done=>{resolve=done;}),0,20,post);await Promise.resolve();
  cache.invalidate(post);
  await cache.read('id',async()=>[{id:'new',body:'safe'}],0,20,post);
  resolve([{id:'old',body:'safe'}]);await stale;
  assert.equal(storage.get('id:viewer:member').value[0].id,'new');
});
test('failed provider reads are retryable and never cached as empty comments',async()=>{
  const {cache,storage}=fixture();await assert.rejects(cache.read('id',async()=>{throw Error('provider unavailable');},0,20,post));
  assert.equal(storage.size,0);assert.equal((await cache.read('id',async()=>[{id:'new',body:'safe'}],0,20,post)).total,1);
});
test('authenticated readers never share comment response caches',async()=>{
  const {cache}=fixture();await cache.read('id',async()=>[{id:'private',body:'safe'}],0,20,post);
  assert.deepEqual((await cache.read('id',async()=>[],0,20,{...post,viewerId:'other'})).comments,[]);
});
test('scarce API budgets keep their existing cache while publication still invalidates promptly',async()=>{
  const {cache,storage}=fixture(),github={source:'github',sourceUrl:'https://github.com/org/repo/issues/1',viewerId:'member'};
  await cache.read('id',async()=>[{id:'old',body:'safe'}],0,20,github);assert.equal(storage.get('id:viewer:member').ttl,120000);
  cache.invalidate(github);assert.equal(storage.size,0);
});
