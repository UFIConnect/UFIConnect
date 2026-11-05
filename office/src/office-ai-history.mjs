export function officeAIHistory(messages, { maxMessages = 12, maxCharacters = 32000 } = {}) {
  const history = messages.filter(item => ['user', 'assistant'].includes(item.role)
    && typeof item.content === 'string' && item.content.trim()).slice(-maxMessages).map(({ role, content }) => ({ role, content }));
  const length = () => history.reduce((total, item) => total + item.content.length, 0);
  // Keep the latest exchange together so a long answer retains its question.
  while (history.length > 2 && length() > maxCharacters) history.shift();
  if (length() <= maxCharacters) return history;
  const firstBudget = history.length === 1 ? maxCharacters : Math.min(history[0].content.length,
    Math.max(Math.floor(maxCharacters / 2), maxCharacters - history[1].content.length));
  return history.map((item, index) => {
    const budget = index ? maxCharacters - firstBudget : firstBudget;
    if (item.content.length <= budget) return item;
    const marker = '\n[Earlier content omitted from context]\n';
    const start = Math.min(2000, Math.floor((budget - marker.length) / 3));
    return { ...item, content: `${item.content.slice(0, start)}${marker}${item.content.slice(-(budget - marker.length - start))}` };
  });
}
