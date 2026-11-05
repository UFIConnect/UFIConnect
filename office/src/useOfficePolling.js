import { useEffect, useState } from 'react';

export function useOfficePageVisible() {
  const read = () => typeof document === 'undefined' || (document.visibilityState !== 'hidden' && !document.hidden);
  const [visible, setVisible] = useState(read);
  useEffect(() => {
    const update = () => setVisible(read());
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}
