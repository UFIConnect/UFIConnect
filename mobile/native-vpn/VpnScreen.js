import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, Text, Pressable, StyleSheet, ActivityIndicator, AppState, Linking } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme';
import { vpn } from './client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { vpnLaunch } from './launchClient';

const {disclosureKey,connectFromIntent} = require('./launchConnection.cjs');
const {createVpnActionGate,runVpnAction} = require('./action.cjs');

const LABELS = { unknown: 'VPN status unavailable', unavailable: 'Native VPN unavailable', disconnected: 'Disconnected', starting: 'Starting VPN', connecting: 'Waiting for secure connection', connected: 'Connected', stopping: 'Disconnecting' };
export default function VpnScreen({route}) {
  const { token, profile } = useAuth();
  const liveToken = useRef(token); liveToken.current = token;
  const operationGate = useRef(null);
  if (!operationGate.current) operationGate.current = createVpnActionGate(() => liveToken.current);
  const handledLaunch = useRef(null);
  const consentKey = disclosureKey(profile?.id);
  const [consent, setConsent] = useState({key:null,accepted:false,loaded:false});
  const disclosureReady = consent.key === consentKey && consent.loaded;
  const disclosureAccepted = Boolean(consentKey) && disclosureReady && consent.accepted;
  const [launchWaiting, setLaunchWaiting] = useState(false);
  const [status, setStatus] = useState({state: vpn.supported() ? 'disconnected' : 'unavailable'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    liveToken.current=token;setBusy(false);setError('');
    return () => {liveToken.current=null;operationGate.current.cancel();};
  },[token]);
  useEffect(() => {
    let active = true;
    setLaunchWaiting(false);
    const read = consentKey ? AsyncStorage.getItem(consentKey) : Promise.resolve(null);
    read.then(value => {if (active) setConsent({key:consentKey,accepted:value==='accepted',loaded:true});})
      .catch(() => {if (active) setConsent({key:consentKey,accepted:false,loaded:true});});
    return () => {active=false;};
  }, [consentKey]);
  useEffect(() => {
    const id = route?.params?.launchRequestId;
    if (!id || handledLaunch.current === id || !disclosureReady) return;
    handledLaunch.current = id;
    if (!vpnLaunch.claim(id, token)) return;
    if (disclosureAccepted) void act(false, true);
    else setLaunchWaiting(true);
  }, [route?.params?.launchRequestId, token, disclosureReady, disclosureAccepted]);
  useEffect(() => {
    let active = true, polling = false;
    const refresh = async () => {
      if (polling || AppState.currentState !== 'active') return;
      polling = true;
      try { const value = await vpn.status(); if (active) setStatus(value); }
      catch { if (active) { setStatus({state:'unknown'}); setError('VPN status is unavailable. Check device VPN settings.'); } }
      finally { polling = false; }
    };
    refresh(); const timer = setInterval(refresh, 2000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, [token]);
  async function act(disconnect, automatic = false) {
    const session = token;
    await runVpnAction({gate:operationGate.current,session,
      onStart:() => {setBusy(true);setError('');},
      action:async isCurrent => {
      let warning = '';
      if (disconnect) {
        const result = await vpn.disconnect(session);
        if (!isCurrent()) return null;
        if (!result.revoked) warning = 'VPN stopped on this device. Server removal could not be confirmed. Remove this device from your VPN account when you are online.';
      } else {
        await connectFromIntent({session,automatic,accepted:disclosureAccepted,vpn,
          isCurrent,
          acknowledge:async () => {
            if (consentKey) await AsyncStorage.setItem(consentKey,'accepted');
            if (isCurrent()) setConsent({key:consentKey,accepted:true,loaded:true});
          },
        });
      }
      if (!isCurrent()) return null;
      const value = await vpn.status();
      return {value,warning};
      },
      onSuccess:result => {if (result) {setStatus(result.value);setError(result.warning);setLaunchWaiting(false);}},
      onError:e => {
      // Do not surface raw native/network objects, request headers, or configurations.
      const code = e?.response?.status;
      setError(code === 403 ? 'VPN requires an active paid membership.' : code === 409 ? 'This device could not be enrolled. Disconnect and try again, or remove an old device.' : code === 503 ? 'VPN service is currently unavailable.' : 'VPN could not complete the request. Check your connection and device VPN permission, then try again.');
      },
      onFinish:() => setBusy(false),
    });
  }
  const active = ['unknown', 'connected', 'connecting', 'starting', 'stopping'].includes(status.state);
  return <ScrollView style={{flex:1,backgroundColor:'#fff'}} contentContainerStyle={styles.page}>
    <Text style={styles.title}>UFIConnect VPN</Text>
    <Text style={styles.status} accessibilityLiveRegion="polite">{LABELS[status.state]}</Text>
    <Text style={styles.body}>Connect this device through your UFIConnect VPN gateway. Your device asks for VPN permission the first time.</Text>
    <Text style={styles.body}>The connection routes device traffic and DNS through the tunnel. IPv6 traffic is blocked by this gateway. Disconnecting restores your regular connection.</Text>
    <Text style={styles.body}>To authorize and secure your connection, UFIConnect stores your account ID, device label, public connection key, assigned tunnel address, gateway, registration time, access expiry and revocation state. Your private connection key stays on this device. Device records remain until account deletion and are included in your account export.</Text>
    <Text style={styles.body}>We do not sell VPN user data, use it for advertising, profiling or AI training, or disclose it to third parties for their own purposes. VPN screens and connection activity are excluded from app analytics. Our hosting providers process data needed to operate the service. The gateway forwards traffic and DNS requests; its configuration does not log DNS queries or browsing activity. Network operators still process connection information.</Text>
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://uficonnect.org/privacy').catch(() => setError('Open uficonnect.org/privacy to read the full privacy policy.'))}>
      <Text style={styles.policy}>Read the privacy policy</Text>
    </Pressable>
    {status.state === 'unavailable' && <Text style={styles.body}>Install a UFIConnect native build that includes VPN support. VPN does not run in Expo Go or a browser.</Text>}
    {launchWaiting && <Text style={styles.body}>Your connection request is ready. Review the information above, then agree and connect.</Text>}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {busy && <ActivityIndicator color={COLORS.primary} />}
    <Pressable accessibilityRole="button" disabled={busy || !disclosureReady || status.state === 'unavailable'} onPress={() => act(active)} style={[styles.button, (busy || !disclosureReady || status.state === 'unavailable') && styles.disabled]}>
      <Text style={styles.buttonText}>{active ? 'Disconnect' : disclosureAccepted ? 'Connect' : 'Agree and connect'}</Text>
    </Pressable>
    <Text style={styles.footnote}>Connected appears only when the native tunnel is active and has a recent secure handshake. Signing out disconnects this device.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({page:{flexGrow:1,padding:24,backgroundColor:'#fff',gap:20},title:{fontSize:28,fontWeight:'800',color:COLORS.text},status:{fontSize:20,fontWeight:'700',color:COLORS.primary},body:{fontSize:15,lineHeight:23,color:COLORS.text},policy:{fontSize:15,lineHeight:23,color:COLORS.primary,textDecorationLine:'underline'},button:{padding:17,backgroundColor:COLORS.primary,borderRadius:14,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},disabled:{opacity:0.4},error:{color:COLORS.danger,lineHeight:22},footnote:{fontSize:13,lineHeight:20,color:COLORS.muted}});
