const test = require('node:test');
const assert = require('node:assert/strict');
const {jobDescriptionText, importedContentLimit} = require('./job-content');
const {screenImportedFeedPost} = require('./content-screening');
const {extractFeedMedia} = require('./rss-media');
const {normalizePostMedia} = require('./post-media');
test('job responsibilities after lengthy company copy survive screening and summarization',async()=>{
 const {summarizeJob,isCareerPost}=await import('../web/src/utils/jobSummary.mjs');
 const html='<h2>About us</h2><p>'+('Our company serves customers around the world with practical products. '.repeat(60))+'</p><h2>About the role</h2><p>This role helps customers keep their accounts secure and available.</p><h2>Responsibilities</h2><ul><li>Design resilient services for customer accounts.</li><li>Maintain incident response and test recovery procedures.</li></ul><h2>Requirements</h2><p>Experience with distributed systems is required.</p>';
 for(const source of ['indeed','remoteok','remotive','muse','usajobs']){
  const post={id:source+'-full',source,sourceUrl:'https://example.com/job',title:'Platform engineer',content:jobDescriptionText(html)};
  const result=screenImportedFeedPost(post);assert.equal(result.allowed,true);assert.ok(result.post.content.length>2000);
  const summary=summarizeJob(result.post);assert.match(summary.summary,/This role helps customers/);assert.match(summary.details.join(' '),/Design resilient services/);assert.match(summary.details.join(' '),/Maintain incident response/);assert.ok(isCareerPost(post));
  assert.doesNotMatch(summary.details.join(' '),/Experience with distributed/);
 }
 assert.equal(importedContentLimit({source:'news'}),100000);
});
test('missing descriptions never invent role tasks',async()=>{
 const {summarizeJob}=await import('../web/src/utils/jobSummary.mjs');
 assert.equal(summarizeJob({title:'Doctor'}).summary,'');
 assert.equal(summarizeJob({content:'An employer with offices worldwide.'}).hasTasks,false);
 const job=summarizeJob({description:'This position protects customer accounts.',content:'Responsibilities\nBuild secure systems for customer accounts.'});
 assert.equal(job.summary,'This position protects customer accounts.');
 assert.match(job.details.join(' '),/Build secure systems/);
});
test('RSS media handles all enclosures, entities, relative URLs and lazy images',()=>{
 const block='<media:content url="https://cdn.test/logo.png" type="image/png"/><media:content TYPE = "video/mp4" url="https://cdn.test/film.mp4?x=1&amp;y=2"/>';
 assert.deepEqual(extractFeedMedia(block,'','https://site.test/article'),{image:'https://cdn.test/logo.png',video:'https://cdn.test/film.mp4?x=1&y=2'});
 assert.equal(extractFeedMedia('','<img width="1" height="1" src="/pixel.gif"><img src="data:image/gif;base64,x" data-src="/photos/story.jpg">','https://site.test/article').image,'https://site.test/photos/story.jpg');
 assert.equal(extractFeedMedia('','<img srcset="/small.jpg 300w, //cdn.test/large.jpg 1200w">','https://site.test/article').image,'https://cdn.test/large.jpg');
 assert.equal(extractFeedMedia('','<iframe src="https://player.vimeo.com/video/123456"></iframe>','https://site.test/article').video,'https://vimeo.com/123456');
 assert.equal(extractFeedMedia('','<iframe src="https://evil.test/youtube.com/embed/abcdefghijk"></iframe>','https://site.test/article').video,null);
});
test('cached media URLs recover missing types without accepting executable URLs',()=>{
 assert.deepEqual(normalizePostMedia({sourceUrl:'https://site.test/post',mediaUrl:'/photo.jpg?x=1&amp;y=2'}),{sourceUrl:'https://site.test/post',mediaUrl:'https://site.test/photo.jpg?x=1&y=2',mediaType:'image',mediaPoster:null});
 assert.equal(normalizePostMedia({mediaUrl:'https://cdn.test/movie.mp4'}).mediaType,'video');
 assert.equal(normalizePostMedia({mediaUrl:'javascript:alert(1)'}).mediaUrl,null);
 assert.equal(normalizePostMedia({mediaUrl:'https://name:secret@site.test/photo.jpg'}).mediaUrl,null);
});

test('complete listings survive cache, database storage and opportunity mapping; RSS uses the full body',async()=>{
 const {createAppHarness}=require('./test-support/app-harness');
 const app=await createAppHarness({connected:true});
 try {
  const content='Company information. '.repeat(160)+'\nResponsibilities\nBuild secure account services for customers.';
  const post={id:'full-job',source:'remotive',sourceUrl:'https://example.com/job',title:'Engineer',content,createdAt:new Date().toISOString(),isExternal:true};
  const normalized=app.normalizeFeedPost(app.trimPostContent(post));
  assert.equal(normalized.content,content);
  await app.savePostsToDBFast([normalized],'feed_posts_cache',app.db,{skipTrim:true});
  const write=app.queries.find(q=>q.sql.includes('jsonb_to_recordset'));
  assert.ok(write,'Batch database write occurred');
  assert.equal(JSON.parse(write.params[0])[0].content,content);
  assert.equal(app.mapSharedJobPost(app.dbRowToFeedPost({id:post.id,source:post.source,content,source_url:post.sourceUrl}),'Remotive').content,content);
  const xml='<rss><channel><item><title>Article</title><link>https://example.com/story</link><description>Short preview.</description><content:encoded><![CDATA[<p>Full body explains how secure account access works.</p><img data-src="/photo.jpg">]]></content:encoded></item></channel></rss>';
  const [item]=app.parseRSSItems(xml);
  assert.match(item.desc,/Full body explains/);
  assert.equal(item.image,'https://example.com/photo.jpg');
 } finally {await app.close();}
});
