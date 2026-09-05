export const PREPARATION_ASSET_VERSION = '2026-09-04-2';

export const PREPARATION_TOPICS = [
  'All',
  'Resume',
  'Interview basics',
  'Behavioral',
  'Technical',
  'Video interviews',
  'Offers',
];

// These values migrate completion flags from the retired external catalog.
// They are never used as media URLs or third-party identifiers at runtime.
export const PREPARATION_VIDEOS = [
  {
    id: 'tailored-resume',
    legacyIds: ['LcohcyoCXn8'],
    slug: 'tailored-resume',
    topic: 'Resume',
    title: 'Build a resume for the role',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Turn the job description into a focused resume that makes your strongest evidence easy to find.',
    takeaways: ['Start with the target role', 'Match claims with proof', 'Make every section easy to scan'],
    slides: [
      { label: 'Step 1', title: 'Name the target', body: 'Choose one role and pull out the skills, outcomes, and language the employer repeats.' },
      { label: 'Step 2', title: 'Match evidence to needs', body: 'Select experience that proves you can solve the problems this role is hiring for.' },
      { label: 'Step 3', title: 'Lead with impact', body: 'Start bullets with the action, then show the result with a number or clear outcome.' },
      { label: 'Step 4', title: 'Make it easy to scan', body: 'Use direct headings, consistent dates, and enough white space to find key details quickly.' },
      { label: 'Final check', title: 'Run the ten-second test', body: 'A quick scan should reveal your target, strongest proof, and most relevant skills.' },
    ],
  },
  {
    id: 'professional-introduction',
    legacyIds: ['70mIbOlLyEU'],
    slug: 'professional-introduction',
    topic: 'Interview basics',
    title: 'Answer "Tell me about yourself"',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Build a concise professional story that connects what you do now, your proof, and why this role fits.',
    takeaways: ['Begin in the present', 'Use one relevant proof point', 'Finish with why this role fits'],
    slides: [
      { label: 'Part 1', title: 'Start in the present', body: 'State what you do, the problems you handle, and the strength you want them to remember.' },
      { label: 'Part 2', title: 'Add relevant proof', body: 'Choose one past example that supports the work this team needs you to do.' },
      { label: 'Part 3', title: 'Connect to this role', body: 'Explain why the position is a sensible next step, not simply an available opening.' },
      { label: 'Part 4', title: 'Keep it focused', body: 'Aim for about sixty to ninety seconds and leave room for the interviewer to follow up.' },
      { label: 'Practice line', title: 'Present, proof, purpose', body: 'Use those three beats to stay natural without memorizing every word.' },
    ],
  },
  {
    id: 'closing-questions',
    legacyIds: ['4tv5yV-wpBk'],
    slug: 'closing-questions',
    topic: 'Interview basics',
    title: 'Ask stronger questions at the end',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Use the closing minutes to understand expectations, team priorities, and the next step in the process.',
    takeaways: ['Ask how success is measured', 'Explore current priorities', 'Close by confirming next steps'],
    slides: [
      { label: 'Question 1', title: 'What does success look like?', body: 'Ask what a strong first ninety days or first year would look like in this role.' },
      { label: 'Question 2', title: 'What needs attention now?', body: 'Learn which project, problem, or team priority will matter most when you arrive.' },
      { label: 'Question 3', title: 'How does the team work?', body: 'Ask how decisions, feedback, and collaboration usually happen day to day.' },
      { label: 'Question 4', title: 'Is anything unclear?', body: 'Invite the interviewer to raise a concern you can address before the conversation ends.' },
      { label: 'Close well', title: 'Confirm the next step', body: 'Thank them, restate your interest, and ask what timing you should expect.' },
    ],
  },
  {
    id: 'behavioral-stories',
    legacyIds: ['TPilhhzHTnU'],
    slug: 'behavioral-stories',
    topic: 'Behavioral',
    title: 'Build behavioral stories that land',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Use a simple story structure to show what you owned, how you decided, and what changed because of it.',
    takeaways: ['Set context quickly', 'Spend time on your actions', 'End with evidence and learning'],
    slides: [
      { label: 'Situation', title: 'Set the scene quickly', body: 'Give only the context the listener needs to understand the challenge and stakes.' },
      { label: 'Task', title: 'Clarify your ownership', body: 'State what you were responsible for and what made the situation difficult.' },
      { label: 'Action', title: 'Show your decisions', body: 'Explain what you did, why you chose it, and how you worked with other people.' },
      { label: 'Result', title: 'Make the outcome concrete', body: 'Use a metric, visible change, or lesson that shows what your actions accomplished.' },
      { label: 'Prepare', title: 'Build a small story bank', body: 'Practice examples for conflict, ambiguity, failure, leadership, and a proud result.' },
    ],
  },
  {
    id: 'technical-interview',
    legacyIds: ['we7ba0slWrc'],
    slug: 'technical-interview',
    topic: 'Technical',
    title: 'Think clearly in a technical interview',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Make your reasoning visible by clarifying the problem, testing the solution, and discussing tradeoffs.',
    takeaways: ['Clarify before solving', 'Test as you build', 'Explain tradeoffs out loud'],
    slides: [
      { label: 'Step 1', title: 'Clarify the problem', body: 'Confirm inputs, outputs, constraints, and the behavior expected in edge cases.' },
      { label: 'Step 2', title: 'State an approach', body: 'Describe a workable plan before writing details so the interviewer can follow your reasoning.' },
      { label: 'Step 3', title: 'Test while you build', body: 'Use a normal case, a boundary case, and a failure case to catch assumptions early.' },
      { label: 'Step 4', title: 'Discuss tradeoffs', body: 'Compare complexity, maintainability, and performance instead of claiming one perfect answer.' },
      { label: 'When stuck', title: 'Recover out loud', body: 'Summarize what you know, name the blocker, and choose the next small test.' },
    ],
  },
  {
    id: 'video-interview-setup',
    legacyIds: ['xNGrePi32ho'],
    slug: 'video-interview-setup',
    topic: 'Video interviews',
    title: 'Set up a strong video interview',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Prepare the technology, framing, and backup plan so your conversation stays clear and calm.',
    takeaways: ['Test the complete setup', 'Frame for natural eye contact', 'Keep a backup within reach'],
    slides: [
      { label: 'Tech check', title: 'Test the full route', body: 'Check the meeting link, camera, microphone, headphones, power, and internet connection.' },
      { label: 'Framing', title: 'Keep the camera at eye level', body: 'Use steady front lighting and a simple background with your face clearly visible.' },
      { label: 'Presence', title: 'Look up when it matters', body: 'Watch the screen while listening, then return to the camera for key points.' },
      { label: 'Backup', title: 'Prepare for interruptions', body: 'Keep the dial-in number, charger, notes, and interviewer contact details nearby.' },
      { label: 'Before joining', title: 'Reset, then enter', body: 'Close extra apps, silence alerts, take one breath, and join a few minutes early.' },
    ],
  },
  {
    id: 'offer-conversation',
    legacyIds: ['urpxkLZEklc'],
    slug: 'offer-conversation',
    topic: 'Offers',
    title: 'Handle an offer conversation',
    source: 'UFI Career Studio',
    duration: '0:29',
    summary: 'Review the full package, prepare a specific request, and give yourself time to make a clear decision.',
    takeaways: ['Review total compensation', 'Support a specific request', 'Get the final offer in writing'],
    slides: [
      { label: 'Review', title: 'Look beyond base pay', body: 'Consider benefits, bonus, equity, schedule, location, growth, and the review cycle.' },
      { label: 'Research', title: 'Build a reasonable range', body: 'Use role scope, location, experience, and reliable market data to prepare your request.' },
      { label: 'Ask', title: 'Be specific and positive', body: 'Show enthusiasm, name the adjustment you want, and support it with relevant evidence.' },
      { label: 'Pause', title: 'Give the conversation room', body: 'After making the request, stop talking and let the other person respond.' },
      { label: 'Confirm', title: 'Review the final terms', body: 'Ask for the complete offer in writing and take the agreed time to consider it.' },
    ],
  },
];

const LEGACY_PREPARATION_IDS = new Map(
  PREPARATION_VIDEOS.flatMap(video => video.legacyIds.map(legacyId => [legacyId, video.id])),
);
const CURRENT_PREPARATION_IDS = new Set(PREPARATION_VIDEOS.map(video => video.id));

export function normalizePreparationWatchedIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids
    .map(id => LEGACY_PREPARATION_IDS.get(id) || id)
    .filter(id => CURRENT_PREPARATION_IDS.has(id)))];
}
