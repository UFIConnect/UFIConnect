// Topic tabs use headings that the provider supplied. The full listing remains
// available verbatim even when its headings are unfamiliar or absent.
const suppliedHeading = /^(?:(?:(?:key|main|your|primary|essential|job) )?(?:responsibilities|duties|role tasks)|what you(?:['\u2019]ll| will) (?:do|bring|need)|what you do|the role|about (?:the|this|our) (?:role|position|team|company)|about us|job description|(?:minimum|preferred|required|basic) qualifications|qualifications|(?:job |position )?requirements|benefits|(?:salary and |pay and )?(?:benefits|compensation)|equal opportunity(?: employer)?|how to apply|salary|who (?:we|you) are|what we offer)\s*:?$/i;

export function careerListingSections(fullText) {
  if (!fullText) return [];
  const sections = [{ heading: 'Full listing', text: fullText }];
  let current;
  for (const line of fullText.split('\n')) {
    const heading = line.trim();
    if (suppliedHeading.test(heading)) {
      current = { heading, lines: [] };
      sections.push(current);
    } else if (current) current.lines.push(line);
  }
  return sections.map(section => ({
    heading: section.heading,
    text: section.text ?? section.lines.join('\n').trim(),
  })).filter(section => section.text);
}
