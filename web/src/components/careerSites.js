// Career sources are intentionally separate from social OAuth accounts.
// Live entries already feed Opportunities; external entries keep sign-in and
// search on their official sites.
export const CAREER_SITES = [
  { key: 'indeed', name: 'Indeed', color: '#2557A7', source: 'Indeed', live: true, description: 'Browse live listings matched to your role, resume, and activity.' },
  { key: 'usajobs', name: 'USAJobs', color: '#005EA8', source: 'USAJobs', live: true, description: 'Explore current federal jobs from the official USAJobs feed.' },
  { key: 'remoteok', name: 'Remote OK', color: '#10B981', source: 'Remote OK', live: true, description: 'Explore current remote roles without leaving UFIconnect.' },
  { key: 'remotive', name: 'Remotive', color: '#2563EB', source: 'Remotive', live: true, description: 'Browse remote roles that update in the Opportunities feed.' },
  { key: 'muse', name: 'The Muse', color: '#7C3AED', source: 'The Muse', live: true, description: 'Discover current roles and career opportunities from The Muse.' },
  { key: 'glassdoor', name: 'Glassdoor', color: '#0CAA41', href: 'https://www.glassdoor.com/Job/jobs.htm', loginRequired: true, description: 'Open Glassdoor’s official job search with your own account.' },
  { key: 'handshake', name: 'Handshake', color: '#F97316', href: 'https://app.joinhandshake.com/job-search', loginRequired: true, description: 'Open your school or employer Handshake job search.' },
  { key: 'wellfound', name: 'Wellfound', color: '#111827', href: 'https://wellfound.com/jobs', loginRequired: true, description: 'Search startup roles directly on Wellfound.' },
  { key: 'ziprecruiter', name: 'ZipRecruiter', color: '#E92C2C', href: 'https://www.ziprecruiter.com/jobs-search', description: 'Open ZipRecruiter’s official job search.' },
  { key: 'dice', name: 'Dice', color: '#0066CC', href: 'https://www.dice.com/jobs', description: 'Search technology roles directly on Dice.' },
];
