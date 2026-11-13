import { useEffect, useState } from 'react';
import { Brain, Eye, Footprints, MoveUpRight, RotateCcw } from 'lucide-react';
import { clockText } from './focus-studio-model.mjs';

const PRACTICES = [
  { id: 'attention', label: 'Attention', description: 'Spot the matching pair and ignore the distractors.' },
  { id: 'memory', label: 'Working memory', description: 'Remember a short sequence, then enter it in order.' },
  { id: 'switch', label: 'Rule switching', description: 'Alternate between two rules as the numbers change.' },
];
const ROUNDS = 8;
const SHAPES = ['Circle', 'Square', 'Triangle', 'Diamond'];
const PAIRS = [
  { name: 'Circle', symbol: '●' },
  { name: 'Square', symbol: '■' },
  { name: 'Triangle', symbol: '▲' },
  { name: 'Diamond', symbol: '◆' },
];
const COLORS = [{ name: 'mint', value: '#84e4c4' }, { name: 'amber', value: '#ffce88' }, { name: 'lilac', value: '#c5b5ff' }];
const BODY_STEPS = [
  { icon: Eye, text: 'Look at something across the room.' },
  { icon: MoveUpRight, text: 'Relax your shoulders and shift position.' },
  { icon: Footprints, text: 'Stand or move a little if comfortable.' },
];

function pick(values) {
  return values[Math.floor(Math.random() * values.length)];
}

function attentionRound() {
  const shape = pick(PAIRS);
  const color = pick(COLORS);
  const target = { ...shape, color };
  const alternatives = [
    { ...shape, color: pick(COLORS.filter(item => item !== color)) },
    { ...pick(PAIRS.filter(item => item !== shape)), color },
    { ...pick(PAIRS.filter(item => item !== shape)), color: pick(COLORS.filter(item => item !== color)) },
  ];
  alternatives.splice(Math.floor(Math.random() * 4), 0, target);
  return { target, options: alternatives };
}

export function FocusPractice() {
  const [mode, setMode] = useState('attention');
  const [phase, setPhase] = useState('ready');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [cue, setCue] = useState(null);
  const [sequence, setSequence] = useState([]);
  const [attempt, setAttempt] = useState([]);
  const [lastAnswer, setLastAnswer] = useState('');

  function choose(id) {
    setMode(id);
    setPhase('ready');
    setLastAnswer('');
  }
  function nextCue(index) {
    if (mode === 'attention') setCue(attentionRound());
    else {
      const value = pick([1, 2, 3, 4, 6, 7, 8, 9]);
      const parity = index % 2 === 0;
      const answer = parity ? (value % 2 ? 'Odd' : 'Even') : (value > 5 ? 'Above 5' : 'Below 5');
      setCue({ value, parity, answer });
    }
  }

  function start() {
    setRound(0);
    setScore(0);
    setLastAnswer('');
    if (mode === 'memory') {
      setSequence(Array.from({ length: 4 }, () => pick(SHAPES)));
      setAttempt([]);
      setPhase('memorize');
    } else {
      nextCue(0);
      setPhase('playing');
    }
  }

  function answer(correct) {
    const next = round + 1;
    if (correct) setScore(value => value + 1);
    setLastAnswer(correct ? 'Correct' : 'Missed that one');
    setRound(next);
    if (next === ROUNDS) setPhase('done');
    else nextCue(next);
  }

  function remember(shape) {
    const next = [...attempt, shape];
    setAttempt(next);
    if (next.length < sequence.length) return;
    setScore(next.filter((item, index) => item === sequence[index]).length);
    setPhase('done');
  }

  return <section className="focus-card focus-practice" aria-labelledby="focus-practice-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Brain size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-practice-title">Brain practice</h2><p>Warm up with a short exercise.</p></div>
    </div>
    <div className="focus-chips" role="group" aria-label="Brain exercise">
      {PRACTICES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id}
        className="focus-chip" onClick={() => choose(item.id)}>{item.label}</button>)}
    </div>
    <div className="focus-practice-stage">
      {phase === 'ready' && <>
        <p>{PRACTICES.find(item => item.id === mode).description}</p>
        <button className="focus-button" type="button" onClick={start}>Start exercise <MoveUpRight size={15} aria-hidden="true" /></button>
      </>}
      {phase === 'memorize' && <>
        <p>Read the sequence from left to right.</p>
        <ol className="focus-sequence">{sequence.map((shape, index) => <li key={index}>{shape}</li>)}</ol>
        <button className="focus-button" type="button" onClick={() => setPhase('recall')}>Hide sequence</button>
      </>}
      {phase === 'recall' && <>
        <p>Choose item {attempt.length + 1} of {sequence.length}.</p>
        <div className="focus-chips">{SHAPES.map(shape => <button key={shape} type="button" className="focus-chip" onClick={() => remember(shape)}>{shape}</button>)}</div>
      </>}
      {phase === 'playing' && <>
        <p><small>Round {round + 1} of {ROUNDS}</small></p>
        {mode === 'attention' && <>
          <p>Find the <strong>{cue.target.color.name} {cue.target.name.toLowerCase()}</strong>.</p>
          <div className="focus-chips">{cue.options.map(item => <button key={`${item.name}-${item.color.name}`} type="button"
            className="focus-chip focus-shape" aria-label={`${item.color.name} ${item.name.toLowerCase()}`}
            onClick={() => answer(item === cue.target)} style={{ color: item.color.value }}>{item.symbol}</button>)}</div>
        </>}
        {mode === 'switch' && <>
          <p><strong>{cue.value}</strong> · {cue.parity ? 'Even or odd?' : 'Below or above five?'}</p>
          <div className="focus-chips">{(cue.parity ? ['Even', 'Odd'] : ['Below 5', 'Above 5']).map(choice =>
            <button key={choice} type="button" className="focus-chip" onClick={() => answer(choice === cue.answer)}>{choice}</button>)}</div>
        </>}
      </>}
      {phase === 'done' && <>
        <p role="status"><strong>{score} / {mode === 'memory' ? sequence.length : ROUNDS}</strong> correct.</p>
        {mode === 'memory' && <p className="focus-footnote">Sequence: {sequence.join(' · ')}</p>}
        <button className="focus-button" type="button" onClick={start}><RotateCcw size={15} aria-hidden="true" />Try again</button>
      </>}
      {phase === 'playing' && <p className="focus-feedback" aria-live="polite">{lastAnswer}</p>}
    </div>
  </section>;
}

export function FocusBody({ reminders, onReminderChange, reminder, end, onEnd, onTakeBreak }) {
  const [left, setLeft] = useState(60);
  useEffect(() => {
    if (end === null) return undefined;
    const update = () => {
      const seconds = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(seconds);
      if (!seconds) onEnd();
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [end, onEnd]);

  const activeStep = end === null ? -1 : Math.min(2, Math.floor((60 - left) / 20));

  return <section className="focus-card focus-body" aria-labelledby="focus-body-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Footprints size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-body-title">Body reset</h2><p>Give your eyes and posture a short break.</p></div>
    </div>
    <ol className="focus-body-steps">
      {BODY_STEPS.map(({ icon: Icon, text }, index) => <li key={text} aria-current={index === activeStep ? 'step' : undefined}>
        <Icon size={16} aria-hidden="true" /><span>{text}</span>
      </li>)}
    </ol>
    {reminder && <p className="focus-feedback" role="status">Your work interval ended. Take a minute to reset.</p>}
    <button type="button" className="focus-button" onClick={() => {
      if (end !== null) { setLeft(60); onEnd(); return; }
      onTakeBreak();
    }}>{end !== null ? 'End reset' : 'Start 1-minute reset'}</button>
    {end !== null && <output className="focus-break-clock" role="timer">{clockText(left)}</output>}
    {activeStep >= 0 && <span className="focus-sr-only" aria-live="polite">{BODY_STEPS[activeStep].text}</span>}
    {left === 0 && <p className="focus-feedback" role="status">Reset complete.</p>}
    <label className="focus-check"><input type="checkbox" checked={reminders}
      onChange={event => onReminderChange(event.target.checked)} />Remind me when the work timer ends</label>
  </section>;
}
