import { useEffect, useRef, useState } from 'react';
import { officeWelcome } from './office-welcome.mjs';

export default function useOfficeWelcome({ request, apiBase, pipelineBase, getToken, onOpen }) {
  const [briefing, setBriefing] = useState(null);
  const sequence = useRef(0);
  useEffect(() => {
    let controller;
    const greet = async () => {
      controller?.abort();
      const current = ++sequence.current;
      setBriefing(null);
      if (!getToken()) return;
      controller = new AbortController();
      const activeController = controller, signal = controller.signal;
      const timer = setTimeout(() => activeController.abort(), 20000);
      const read = async url => {
        const response = await request(url, { signal });
        if (!response.ok) throw Error('Office update unavailable');
        return response.json();
      };
      const targets = [['api', apiBase], ...(pipelineBase !== apiBase ? [['pipeline', pipelineBase]] : [])];
      try {
        const results = await Promise.allSettled([
          ...targets.map(([, base]) => read(`${base}/office/status`)), read(`${apiBase}/office/ai/tasks?summary=1`),
        ]);
        if (signal.aborted || sequence.current !== current) return;
        const summary = officeWelcome({
          services: targets.map(([role], index) => ({ role, data: results[index].status === 'fulfilled' ? results[index].value : null })),
          tasks: results.at(-1).status === 'fulfilled' ? results.at(-1).value.tasks : null,
        });
        // An entered token alone does not establish successful authentication.
        if (!summary.observed) return;
        onOpen('office-ai');
        setBriefing({ ...summary, id: `office-login-${current}` });
      } finally { clearTimeout(timer); }
    };
    window.addEventListener('office-token-changed', greet);
    if (getToken()) greet();
    return () => { sequence.current++; controller?.abort(); window.removeEventListener('office-token-changed', greet); };
  }, [request, apiBase, pipelineBase, getToken, onOpen]);
  return [briefing, id => setBriefing(previous => previous?.id === id ? null : previous)];
}
