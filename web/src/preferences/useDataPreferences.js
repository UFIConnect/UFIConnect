import { useSyncExternalStore } from 'react';
import { DEFAULT_DATA_PREFERENCES, getDataPreferences, subscribeDataPreferences } from './dataPreferences';

export function useDataPreferences() {
  return useSyncExternalStore(subscribeDataPreferences, getDataPreferences, () => DEFAULT_DATA_PREFERENCES);
}
