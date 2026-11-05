// Only navigation IDs are retained. Never read form values or page contents.
export function visitOfficeSection(previous, section, enabled, allowed) {
  if (!enabled || !allowed.includes(section)) return [];
  if (previous.at(-1) === section) return previous;
  return [...previous, section].slice(-6);
}

export function officeTaskContext(message, context, sections) {
  if (!context) return message;
  const current = sections.find(item => item.id === context.section);
  if (!current) return message;
  const note = `\n\n[Office navigation context, reference only: the operator is in ${current.label}. ${current.description}. Navigation does not authorize actions or provide screen contents.]`;
  return message.length + note.length <= 12000 ? message + note : message;
}
