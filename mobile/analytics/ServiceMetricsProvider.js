import React, { createContext, useContext, useEffect, useRef } from 'react';
import Constants from 'expo-constants';
import { resolveApiBase } from '../security/apiConfig';
import { usePreferences } from '../context/PreferencesContext';
import { createServiceMetrics, supportsErrorCollection, installErrorCollection } from './serviceMetrics';

const ServiceMetricsContext = createContext(null);
export const useServiceMetrics = () => useContext(ServiceMetricsContext);
const apiBase = resolveApiBase(Constants.expoConfig?.extra?.apiUrl, __DEV__);

export default function ServiceMetricsProvider({ children }) {
  const { subscribe } = usePreferences();
  const controller = useRef(null);
  const latestScreen = useRef(null);
  const latestTab = useRef(null);
  const performanceAvailable = supportsErrorCollection(globalThis);
  useEffect(() => {
    const metrics = createServiceMetrics({ apiBase, fetcher: (...args) => fetch(...args) });
    controller.current = metrics;
    if (latestScreen.current) metrics.trackScreen(...latestScreen.current);
    if (latestTab.current) metrics.trackTab(latestTab.current);
    let detach = () => {};
    const unsubscribe = subscribe((preferences, ready) => {
      const enabled = ready && preferences.performanceInsights && performanceAvailable;
      metrics.setPerformanceEnabled(enabled);
      detach();
      detach = enabled ? installErrorCollection(globalThis, code => metrics.reportError(code)) : () => {};
    });
    return () => { unsubscribe(); detach(); controller.current = null; metrics.dispose(); };
  }, [subscribe, performanceAvailable]);
  return <ServiceMetricsContext.Provider value={{ performanceAvailable, trackScreen(name, key) {
    latestScreen.current = [name, key];
    if (name !== 'ProfileMain') latestTab.current = null;
    controller.current?.trackScreen(name, key);
    if (name === 'ProfileMain' && latestTab.current) controller.current?.trackTab(latestTab.current);
  }, trackTab(name) {
    latestTab.current = name;
    controller.current?.trackTab(name);
  } }}>{children}</ServiceMetricsContext.Provider>;
}
