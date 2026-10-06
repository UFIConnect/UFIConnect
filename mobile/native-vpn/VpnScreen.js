import React, { useEffect, useState } from 'react';
import { ScrollView, Text, Pressable, StyleSheet, ActivityIndicator, AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme';
import { vpn } from './client';

const LABELS = { unknown: 'VPN status unavailable', unavailable: 'Native VPN unavailable', disconnected: 'Disconnected', starting: 'Starting VPN', connecting: 'Waiting for secure connection', connected: 'Connected', stopping: 'Disconnecting' };
export default function VpnScreen() {
  const { token } = useAuth();
  const [status, setStatus] = useState({state: vpn.supported() ? 'disconnected' : 'unavailable'});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
  async function act(disconnect) {
    setBusy(true); setError('');
    try {
      if (disconnect) {
        const result = await vpn.disconnect(token);
        if (!result.revoked) setError('VPN stopped on this device. Server removal could not be confirmed. Remove this device from your VPN account when you are online.');
      } else await vpn.connect(token);
      setStatus(await vpn.status());
    } catch (e) {
      // Do not surface raw native/network objects, request headers, or configurations.
      const code = e?.response?.status;
      setError(code === 403 ? 'VPN requires an active paid membership.' : code === 409 ? 'This device could not be enrolled. Disconnect and try again, or remove an old device.' : code === 503 ? 'VPN service is currently unavailable.' : 'VPN could not complete the request. Check your connection and device VPN permission, then try again.');
    } finally { setBusy(false); }
  }
  const active = ['unknown', 'connected', 'connecting', 'starting', 'stopping'].includes(status.state);
  return <ScrollView style={{flex:1,backgroundColor:'#fff'}} contentContainerStyle={styles.page}>
    <Text style={styles.title}>UFIConnect VPN</Text>
    <Text style={styles.status} accessibilityLiveRegion="polite">{LABELS[status.state]}</Text>
    <Text style={styles.body}>Connect this device through your UFIConnect VPN gateway. Your device asks for VPN permission the first time.</Text>
    <Text style={styles.body}>The connection routes device traffic and DNS through the tunnel. IPv6 traffic is blocked by this gateway. Disconnecting restores your regular connection.</Text>
    <Text style={styles.body}>To provide VPN access, UFIConnect stores your account ID, device label, public connection key, assigned IP addresses, gateway, and session expiry. Your private connection key stays on this device. The gateway processes your traffic and DNS requests to forward them. VPN activity is excluded from app analytics.</Text>
    {status.state === 'unavailable' && <Text style={styles.body}>Install a UFIConnect native build that includes VPN support. VPN does not run in Expo Go or a browser.</Text>}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {busy && <ActivityIndicator color={COLORS.primary} />}
    <Pressable accessibilityRole="button" disabled={busy || status.state === 'unavailable'} onPress={() => act(active)} style={[styles.button, (busy || status.state === 'unavailable') && styles.disabled]}>
      <Text style={styles.buttonText}>{active ? 'Disconnect' : 'Connect'}</Text>
    </Pressable>
    <Text style={styles.footnote}>Connected appears only when the native tunnel is active and has a recent secure handshake. Signing out disconnects this device.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({page:{flexGrow:1,padding:24,backgroundColor:'#fff',gap:20},title:{fontSize:28,fontWeight:'800',color:COLORS.text},status:{fontSize:20,fontWeight:'700',color:COLORS.primary},body:{fontSize:15,lineHeight:23,color:COLORS.text},button:{padding:17,backgroundColor:COLORS.primary,borderRadius:14,alignItems:'center'},buttonText:{color:'#fff',fontWeight:'800',fontSize:16},disabled:{opacity:0.4},error:{color:COLORS.danger,lineHeight:22},footnote:{fontSize:13,lineHeight:20,color:COLORS.muted}});
