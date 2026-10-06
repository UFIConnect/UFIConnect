import React, { useEffect, useLayoutEffect } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { vpnLaunch } from './launchClient';

export default function VpnLaunchBridge({navigationRef, navigationReady}) {
  const {token,loading,onboardingComplete} = useAuth();
  useLayoutEffect(() => {
    vpnLaunch.bindSession(token, !loading && onboardingComplete && navigationReady);
    void vpnLaunch.flush();
  }, [token,loading,onboardingComplete,navigationReady]);
  useEffect(() => {
    if (!['ios','android'].includes(Platform.OS)) return undefined;
    const unsubscribe = vpnLaunch.subscribe(event => {
      if (event.type === 'request') {
        navigationRef.current?.navigate('Main', {screen:'Profile',params:{screen:'VPN',params:{launchRequestId:event.id}}});
      } else {
        Alert.alert('VPN link unavailable', 'Open a new VPN link from UFIConnect using the same account signed in to this app.');
      }
    });
    let active = true;
    const subscription = Linking.addEventListener('url', ({url}) => vpnLaunch.open(url));
    Linking.getInitialURL().then(url => {if (active && url) vpnLaunch.open(url);}).catch(() => {});
    return () => {active=false;subscription.remove();unsubscribe();vpnLaunch.bindSession(null,false);};
  }, [navigationRef]);
  return null;
}
