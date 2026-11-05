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
      const signal = controller.signal;
      const read = async url => {
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), 15000);
        const cancel = () => timeout.abort(); signal.addEventListener('abort', cancel, { once: true });
        try {
          const response = await request(url, { signal: timeout.signal, cache: 'no-store' });
          if (!response.ok) throw Error('Office update unavailable');
          return await response.json();
        } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
      };
      const targets = [['api', apiBase], ...(pipelineBase !== apiBase ? [['pipeline', pipelineBase]] : [])];
      const results = await Promise.allSettled([
        ...targets.map(([, base]) => read(`${base}/office/status`)),
        read(`${apiBase}/office/welcome?timeZone=America%2FLos_Angeles`),
      ]);
      if (signal.aborted || sequence.current !== current) return;
      const summary = officeWelcome({
        services: targets.map(([role], index) => ({ role, data: results[index].status === 'fulfilled' ? results[index].value : null })),
        summary: results.at(-1).status === 'fulfilled' ? results.at(-1).value : null,
      });
      // An entered token alone does not establish successful authentication.
      if (!summary.observed) return;
      onOpen('office-ai');
      setBriefing({ ...summary, id: `office-login-${current}` });
    };
    window.addEventListener('office-token-changed', greet);
    if (getToken()) greet();
    return () => { sequence.current++; controller?.abort(); window.removeEventListener('office-token-changed', greet); };
  }, [request, apiBase, pipelineBase, getToken, onOpen]);
  return [briefing, id => setBriefing(previous => previous?.id === id ? null : previous)];
}
