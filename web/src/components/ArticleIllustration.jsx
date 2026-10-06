import { BookOpen, BrainCircuit, Briefcase, Code2, Globe2, HeartPulse, Leaf, Lightbulb, Palette, Rocket, ShieldCheck } from 'lucide-react';
import './PostDetails.css';
const TOPICS = [
  [/\b(ai|artificial intelligence|machine learning|neural|llm)\b/i,'AI and technology',BrainCircuit],
  [/\b(security|privacy|password|cyber|encryption)\b/i,'Security and privacy',ShieldCheck],
  [/\b(code|software|developer|programming|javascript|python)\b/i,'Software and development',Code2],
  [/\b(health|medical|medicine|hospital|disease|wellness)\b/i,'Health and research',HeartPulse],
  [/\b(climate|energy|environment|solar|nature|sustainab)\w*/i,'Energy and environment',Leaf],
  [/\b(business|market|startup|economy|finance|invest)\w*/i,'Business and ideas',Briefcase],
  [/\b(space|rocket|satellite|nasa|planet)\b/i,'Space and discovery',Rocket],
  [/\b(design|creative|art|typography|photography)\b/i,'Design and creativity',Palette],
  [/\b(travel|cities|city|world|country|community)\b/i,'People and places',Globe2],
];
const ARTICLES = new Set(['medium','techcrunch','theverge','arstechnica','wired','theregister','venturebeat','smashing','phoronix','infoq','mittr','hashnode','devto','hackernews','lobsters','freecodecamp','thenewstack','yc','ycombinator','css-tricks','csstricks','producthunt']);
export function needsArticleIllustration(post) {
  return ARTICLES.has(post?.source) && String(post.content || '').length >= 500 && !post.mediaUrl && !post.mediaPoster && !post.embedId;
}
export default function ArticleIllustration({ post }) {
  if (!needsArticleIllustration(post)) return null;
  const text = String(post.title || '') + ' ' + String(post.topic || '') + ' ' + String(post.content || '').slice(0,1500);
  const [, label, Icon] = TOPICS.find(([test])=>test.test(text)) || [null,'Ideas and perspectives',Lightbulb];
  return <figure className="post-topic-illustration">
    <svg viewBox="0 0 600 220" role="img" aria-label={'Topic illustration: ' + label}>
      <rect width="600" height="220" fill="currentColor" opacity=".045" />
      <circle cx="300" cy="110" r="82" fill="currentColor" opacity=".06" />
      <path d="M120 110H222M378 110H480" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 7" opacity=".45" />
      <rect x="244" y="54" width="112" height="112" rx="24" fill="currentColor" opacity=".12" />
      <Icon x="268" y="78" width="64" height="64" strokeWidth="1.5" />
      <BookOpen x="76" y="86" width="48" height="48" strokeWidth="1.4" opacity=".7" />
      <Lightbulb x="476" y="86" width="48" height="48" strokeWidth="1.4" opacity=".7" />
    </svg>
    <figcaption>Topic illustration · {label}. Added by UFIConnect; not a photo from the article.</figcaption>
  </figure>;
}
