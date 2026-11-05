import { ArrowBigUp, Hand, Star, ThumbsUp } from 'lucide-react';
import { HeartIcon } from './PostCardChrome';

export default function SourceReactionIcon({ kind, active }) {
  const Icon = { star: Star, upvote: ArrowBigUp, 'thumbs-up': ThumbsUp, clap: Hand }[kind];
  return Icon ? <Icon size={17} aria-hidden="true" fill={active ? 'currentColor' : 'none'} /> : <HeartIcon filled={active} />;
}
