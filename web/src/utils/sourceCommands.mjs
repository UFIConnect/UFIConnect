import commands from '../../../shared/source-post-commands.json' with { type: 'json' };

const readOnly = Object.freeze({ reaction: null, discussion: 'Comment', discussions: 'Discussion' });
export function sourcePostCommands(source) {
  const key = source === 'x' ? 'twitter' : !source || source === 'livecamera' ? 'uficonnect' : source;
  return commands[key] || readOnly;
}
