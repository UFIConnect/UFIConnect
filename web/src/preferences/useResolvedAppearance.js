import { useSyncExternalStore } from 'react';

const subscribe = callback => {
  window.addEventListener('ufi:appearance', callback);
  return () => window.removeEventListener('ufi:appearance', callback);
};
const snapshot = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
const serverSnapshot = () => 'light';

export function useResolvedAppearance() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
