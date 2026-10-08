'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const directory = require('./account-directory.json');
const { importedContentLimit, usaJobsDescription, jobDescriptionText } = require('./job-content');
let summarizeJob, isCareerPost, careerListingSections;
before(async () => {
  ({ summarizeJob, isCareerPost } = await import('../web/src/utils/jobSummary.mjs'));
  ({ careerListingSections } = await import('../web/src/utils/careerListingSections.mjs'));
});
test('all catalog career sources and display names use role summaries and preserve complete descriptions', () => {
  for (const [source, entry] of Object.entries(directory).filter(([, entry]) => entry.category === 'career')) {
    for (const name of [source, entry.name]) {
      const post = { source: name, content: 'Responsibilities\n- Write code\n- Test APIs\nRequirements\n- JavaScript\nBenefits\n- Paid leave' };
      assert.equal(isCareerPost(post), true, name);
      assert.equal(importedContentLimit(post), 60000, name);
      assert.deepEqual(summarizeJob(post).tasks, ['Write code', 'Test APIs'], name);
      assert.match(summarizeJob(post).summary, /Write code; Test APIs\./, name);
    }
  }
  assert.equal(isCareerPost({ source: 'uficonnect', sourceLabel: 'Hiring' }), true);
  assert.equal(isCareerPost({ type: 'job', source: 'new-provider' }), true);
  for (const source of ['linkedin', 'reuters', 'airbnb', 'github']) {
    assert.equal(isCareerPost({ source, content: 'An ordinary post.' }), false);
    assert.equal(importedContentLimit({ source }), 2000);
  }
});
test('short tasks, curly apostrophes and common site headings remain distinct from requirements and benefits', () => {
  for (const heading of ['What you’ll do', "What you'll do", 'What you will be doing', 'Your key responsibilities', 'Day-to-day responsibilities', 'Essential duties & responsibilities', 'Major duties', 'Job functions', 'Your impact', 'Responsibilities include, but are not limited to:']) {
    const job = summarizeJob({ title: 'Engineer', description: `Join our team to build software.\n${heading}\n- Write code\n- Test APIs\nWhat you’ll bring\n- A degree\n- Experience building products\nWhat we offer\n- Paid leave` });
    assert.deepEqual(job.tasks, ['Write code','Test APIs'], heading);
    assert.deepEqual(job.requirements, ['A degree','Experience building products'], heading);
    assert.doesNotMatch(job.summary, /degree|Paid leave|Experience/);
  }
});
test('inline and bold HTML headings, entities and bullets retain tasks without treating scripts as listing content', () => {
  const job = summarizeJob({ content: '<p>Join our team.</p><b>Responsibilities:</b>Write code; Test APIs<strong>Requirements:</strong>A degree<strong>Benefits:</strong>Paid leave<script>evil()</script>' });
  assert.deepEqual(job.tasks, ['Write code','Test APIs']);
  assert.deepEqual(job.requirements, ['A degree']);
  assert.doesNotMatch(job.fullText, /evil|<b>|<script>/);
  const encoded = summarizeJob({ content: '&lt;p&gt;Join our team.&lt;/p&gt;&lt;h2&gt;What you&rsquo;ll do&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Design APIs&lt;/li&gt;&lt;li&gt;Maintain services&lt;/li&gt;&lt;/ul&gt;' });
  assert.deepEqual(encoded.tasks,['Design APIs','Maintain services']);
  const inline = summarizeJob({ content: 'Responsibilities: Answer calls • Schedule visits\nQualifications: Customer service experience\nBenefits: Paid leave' });
  assert.deepEqual(inline.tasks,['Answer calls','Schedule visits']);
  assert.deepEqual(inline.requirements,['Customer service experience']);
});
test('industry verbs and third-person role descriptions are recognized without heading dependence', () => {
  const job = summarizeJob({ content: 'The incumbent prepares reports.\nYou’ll answer calls.\nServing customers at checkout.\nPlanning patient visits.\nProcesses invoices.\nCollaborate with colleagues.\nDrive delivery of projects.\nExperience managing teams is required.\nWork-life balance is offered.' });
  assert.deepEqual(job.tasks,['The incumbent prepares reports.','You’ll answer calls.','Serving customers at checkout.','Planning patient visits.','Processes invoices.','Collaborate with colleagues.','Drive delivery of projects.']);
  assert.doesNotMatch(job.summary,/balance|Experience/);
});
test('imported career HTML preserves bold section headings and inline emphasis preserves sentence meaning', () => {
  const content = jobDescriptionText('<p>We are seeking <strong>helpful people</strong> for our team.</p><strong>Responsibilities</strong>Write code; Test APIs<strong>Requirements</strong>A degree<strong>Benefits</strong>Paid leave');
  const job = summarizeJob({content});
  assert.deepEqual(job.tasks,['Write code','Test APIs']);
  assert.deepEqual(job.requirements,['A degree']);
  assert.match(job.intro,/We are seeking helpful people for our team/);
  assert.doesNotMatch(job.summary,/Paid leave|degree/);
});
test('full supplied descriptions and structured responsibilities are read past the introductory excerpt', () => {
  const job = summarizeJob({ content: 'Short company introduction.', fullDescription: 'About our company\n' + 'Company background. '.repeat(1500) + '\nResponsibilities\n- Investigate incidents\n- Document findings\n- Coordinate releases\nQualifications\n- Relevant experience',
    duties: ['Review logs','Train staff'], requirements: [{ text: 'Communication skills' }] });
  assert.ok(job.fullText.length > 25000);
  assert.deepEqual(job.tasks,['Investigate incidents','Document findings','Coordinate releases','Review logs','Train staff']);
  assert.match(job.summary,/Train staff/);
  assert.doesNotMatch(job.summary,/Company background|Relevant experience|Communication/);
  assert.ok(job.requirements.includes('Communication skills'));
});
test('summary deduplicates duties and covers the main tasks rather than repeating only the first two', () => {
  const job = summarizeJob({ content: 'Responsibilities\n- Design APIs\n- Maintain services\n- Review releases\n- Train staff\n- Answer calls\n- Design APIs.' });
  assert.equal(job.tasks.length,5);
  for(const task of ['Design APIs','Maintain services','Review releases','Train staff','Answer calls']) assert.ok(job.summary.includes(task));
  assert.equal(job.summary.match(/Design APIs/g).length,1);
});
test('company descriptions, qualifications and benefits alone cannot become a role task summary', () => {
  for (const content of ['About us\nBuild exceptional software for our customers.\nRequirements\nDesign experience\nBenefits\nPaid leave', 'Qualifications\nMaintain a valid license\nBenefits\nCompetitive salary', 'Engineer at Example company']) {
    const job = summarizeJob({ title:'Engineer at Example company', content });
    assert.equal(job.hasTasks,false);assert.equal(job.summary,'');
  }
});
test('USAJobs keeps major duties separated from qualification text before feed import', () => {
  const content = usaJobsDescription({ PositionTitle:'Program specialist', UserArea:{Details:{JobSummary:'Support the program.',MajorDuties:['Review reports','Maintain records']}}, QualificationSummary:'Experience managing records is required.' });
  const job = summarizeJob({ source:'usajobs', content });
  assert.deepEqual(job.tasks,['Support the program.','Review reports','Maintain records']);
  assert.deepEqual(job.requirements,['Experience managing records is required.']);
  assert.doesNotMatch(job.summary,/Experience/);
});
test('full-listing topics and role summaries use the same responsibility boundaries', () => {
  const job = summarizeJob({ content:'What you’ll do: Write code; Review changes\nRequired skills & experience\nJavaScript\nPhysical demands\nStanding during shifts\nBenefits\nPaid leave' });
  assert.deepEqual(job.tasks,['Write code','Review changes']);
  const sections=careerListingSections(job.fullText);
  assert.equal(sections[0].heading,'Full listing');
  assert.ok(sections.find(section=>section.heading==='What you’ll do').text.includes('Review changes'));
  assert.doesNotMatch(sections.find(section=>section.heading==='What you’ll do').text,/JavaScript|Standing|Paid leave/);
  assert.deepEqual(job.requirements,['JavaScript']);
});
