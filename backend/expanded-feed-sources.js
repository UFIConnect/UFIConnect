'use strict';
// Reuse each public feed across topic workers and manual refreshes. Single-flight
// avoids duplicate calls; the one-hour inventory cache also bounds provider load.
function createExpandedFeedSources({fetchText,parseRSSItems,rssPost,now=Date.now}) {
 const cache=new Map(),pending=new Map(),ttl=60*60000;
 async function inventory(source,load){
  if(cache.get(source)?.expiresAt>now())return cache.get(source).posts;
  if(pending.has(source))return pending.get(source);
  const task=Promise.resolve().then(load).then(posts=>{cache.set(source,{posts,expiresAt:now()+ttl});return posts;}).finally(()=>pending.delete(source));
  pending.set(source,task);return task;
 }
 const rss=(source,label,url,category)=>()=>inventory(source,async()=>{
  const xml=await fetchText(url);
  if(!/<(?:rss|feed)[\s>]/i.test(xml))throw Error(label+' returned an invalid feed.');
  return parseRSSItems(xml).slice(0,80).map(item=>rssPost(category==='Travel'?{...item,desc:(item.desc||'').slice(0,500)}:item,source,label,'ext_'+source,label,category,category==='Travel'?'Travel':null));
 });
 return {
  weworkremotely:rss('weworkremotely','We Work Remotely','https://weworkremotely.com/remote-jobs.rss','Opportunities'),
  cntraveler:rss('cntraveler','Condé Nast Traveler','https://www.cntraveler.com/feed/rss','Travel'),
 };
}
module.exports={createExpandedFeedSources};
