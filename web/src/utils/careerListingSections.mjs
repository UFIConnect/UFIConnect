// Topic tabs use headings that the provider supplied. The full listing remains
// available verbatim even when its headings are unfamiliar or absent.
import { splitCareerSections } from './jobSummary.mjs';

export function careerListingSections(fullText) {
  if (!fullText) return [];
  return [{ heading: 'Full listing', text: fullText }, ...splitCareerSections(fullText)
    .filter(section => section.heading && section.text).map(({ heading, text }) => ({ heading, text }))];
}
