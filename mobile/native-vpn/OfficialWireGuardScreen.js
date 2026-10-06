import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text} from 'react-native';
import {useAuth} from '../context/AuthContext';
import {COLORS} from '../theme';
import {getVpnMembership} from './client';
const {INSTALL_URL, checkProfileAccess, openMemberVpnProfile, openProfileManagement} = require('./officialWireGuard.cjs');
const {createVpnActionGate, runVpnAction} = require('./action.cjs');

export default function OfficialWireGuardScreen() {
  const {token} = useAuth();
  const liveToken = useRef(token); liveToken.current = token;
  const gate = useRef(null);
  if (!gate.current) gate.current = createVpnActionGate(() => liveToken.current);
  const [membership, setMembership] = useState({session:null,state:'checking'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const state = membership.session === token ? membership.state : 'checking';
  useLayoutEffect(() => {
    liveToken.current = token; setBusy(false); setError('');
    return () => {liveToken.current = null; gate.current.cancel();};
  }, [token]);
  async function act(open) {
    await runVpnAction({gate:gate.current, session:token,
      onStart:() => {setBusy(true); setError('');},
      action:isCurrent => open === 'manage'
        ? openProfileManagement({session:token,isCurrent,openURL:Linking.openURL})
        : open
        ? openMemberVpnProfile({session:token,getMembership:getVpnMembership,isCurrent,openURL:Linking.openURL})
        : checkProfileAccess({session:token,getMembership:getVpnMembership,isCurrent}),
      onSuccess:value => {if (!['stale','managed'].includes(value)) setMembership({session:token,state:value === 'opened' ? 'active' : value});},
      onError:() => {setMembership({session:token,state:'unknown'}); setError('Could not confirm access or open the profile page. Check your connection and try again.');},
      onFinish:() => setBusy(false),
    });
  }
  useEffect(() => {void act(false);}, [token]);
  return <ScrollView style={styles.screen} contentContainerStyle={styles.page}>
    <Text style={styles.title}>UFIConnect VPN</Text>
    <Text style={styles.body}>Import your profile once, then connect in the official WireGuard app. Your gateway is selected automatically.</Text>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{state === 'active' ? 'Your UFI Vault membership is active.' : state === 'inactive' ? 'An active UFI Vault membership is required.' : state === 'checking' ? 'Checking membership...' : 'Membership could not be confirmed.'}</Text>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {busy && <ActivityIndicator color={COLORS.primary} />}
    {state === 'active' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => act(true)} style={[styles.button,busy && styles.disabled]}>
      <Text style={styles.buttonText}>Open my VPN profile</Text>
    </Pressable>}
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(INSTALL_URL).catch(() => setError('Search for WireGuard in the App Store.'))}>
      <Text style={styles.link}>Install official WireGuard</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => act(false)}><Text style={styles.link}>Refresh membership</Text></Pressable>
    <Text style={styles.body}>1. Install WireGuard.{ '\n' }2. Open your profile page, sign in to the same account if asked, and download your profile.{ '\n' }3. Import it in WireGuard and approve VPN permission.</Text>
    <Text style={styles.note}>Keep the profile private. Delete the downloaded file after import.</Text>
    <Text style={styles.note}>Check status and disconnect in WireGuard. UFIConnect cannot control its connection; signing out or closing your browser leaves it running. Revoke the profile on your profile page to remove server access.</Text>
    {token && <Pressable accessibilityRole="link" disabled={busy} onPress={() => act('manage')}><Text style={styles.link}>Manage saved profiles</Text></Pressable>}
    <Text style={styles.note}>A password change or reset, signing out all devices, or account deletion invalidates your profiles. Remove old profiles in WireGuard.</Text>
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://uficonnect.org/privacy').catch(() => setError('Open uficonnect.org/privacy to read the privacy policy.'))}><Text style={styles.link}>Read the privacy policy</Text></Pressable>
  </ScrollView>;
}
const styles = StyleSheet.create({screen:{flex:1,backgroundColor:'#fff'},page:{padding:24,gap:16},title:{fontSize:28,fontWeight:'800',color:COLORS.text},body:{fontSize:15,lineHeight:23,color:COLORS.text},note:{fontSize:13,lineHeight:20,color:COLORS.muted},link:{fontSize:15,lineHeight:23,color:COLORS.primary,textDecorationLine:'underline'},button:{padding:17,backgroundColor:COLORS.primary,borderRadius:14,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},disabled:{opacity:0.4},error:{color:COLORS.danger,lineHeight:22}});
