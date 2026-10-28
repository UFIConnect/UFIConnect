const commands = new Map([
  ['take photo', 'photo'], ['take a photo', 'photo'], ['take picture', 'photo'], ['capture', 'capture'],
  ['photo mode', 'photoMode'], ['video mode', 'videoMode'],
  ['start recording', 'record'], ['record video', 'record'], ['stop recording', 'stop'],
  ['pause recording', 'pause'], ['resume recording', 'resume'],
  ['mute recording', 'mute'], ['unmute recording', 'unmute'],
  ['switch camera', 'switch'], ['flip camera', 'switch'],
  ['mirror camera', 'mirror'], ['invert camera', 'mirror'],
  ['timer off', 'timerOff'], ['three second timer', 'timerThree'], ['ten second timer', 'timerTen'],
  ['cancel timer', 'cancelTimer'], ['show commands', 'help'], ['hide commands', 'hideHelp'],
  ['show effects', 'effects'], ['hide effects', 'hideHelp'], ['fit frame', 'fit'], ['fill screen', 'fill'],
  ['stop listening', 'stopListening'], ['close camera', 'close'],
]);

// Exact final phrases only: never interpret negations or partial transcripts
// as capture, publishing, payment, or account commands.
export function cameraVoiceCommand(transcript) {
  if (typeof transcript !== 'string' || transcript.length > 100) return null;
  const phrase = transcript.toLowerCase().trim().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').replace(/^ufi[, ]+/, '').replace(/^please /, '').replace(/,? please$/, '');
  return commands.get(phrase) || null;
}
