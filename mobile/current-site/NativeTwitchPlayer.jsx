import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { allowTwitchNavigation, twitchPageUrl } from './nativeTwitch.cjs';

// This isolated viewer loads a real HTTPS parent page. It has no UFIconnect
// session, DOM capability, native message handler, or injected app scripts.
export default function NativeTwitchPlayer({ player, onClose }) {
  const [location, setLocation] = useState(player.wrapperUrl);
  const [browsingTwitch, setBrowsingTwitch] = useState(false);
  const [failed, setFailed] = useState(false), [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const webView = useRef(null);
  useEffect(() => {
    if (!loading || failed) return undefined;
    const timer = setTimeout(() => { setFailed(true); setLoading(false); }, 30000);
    return () => clearTimeout(timer);
  }, [loading, failed, attempt, location]);
  const showPage = url => { setFailed(false); setLoading(true); setLocation(url); setAttempt(value => value + 1); };
  const returnToClip = () => { setBrowsingTwitch(false); showPage(player.wrapperUrl); };
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.brand}>Twitch</Text>
          <Text style={styles.title} numberOfLines={2}>{player.title}</Text>
          {!!player.creator && <Text style={styles.creator} numberOfLines={1}>By {player.creator} on Twitch</Text>}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Close Twitch player and return to UFIConnect" onPress={onClose} style={styles.button}>
          <Text style={styles.buttonText}>Done</Text>
        </Pressable>
      </View>
      {browsingTwitch && <Pressable accessibilityRole="button" onPress={returnToClip} style={styles.returnButton}><Text style={styles.buttonText}>Back to clip</Text></Pressable>}
      {failed ? <View style={styles.error}>
        <Text style={styles.title}>The Twitch player could not load. Check your connection and try again.</Text>
        <Pressable accessibilityRole="button" onPress={returnToClip} style={styles.button}><Text style={styles.buttonText}>Try again</Text></Pressable>
      </View> : <>
        {loading && <View style={styles.loading} accessibilityLiveRegion="polite"><ActivityIndicator color="#bf94ff" /><Text style={styles.creator}>Loading Twitch player…</Text></View>}
        <WebView key={attempt} ref={webView} source={{ uri: location }} style={styles.viewer}
          // Every scheme must reach our policy. A narrower originWhitelist lets
          // React Native WebView launch unmatched schemes through the OS first.
          originWhitelist={['*']} allowsInlineMediaPlayback allowsFullscreenVideo
          mediaPlaybackRequiresUserAction sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
          contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false} bounces={false}
          onShouldStartLoadWithRequest={request => {
            if (request.isTopFrame !== false && request.url === 'https://uficonnect.org/') { onClose(); return false; }
            return allowTwitchNavigation(request, player);
          }}
          onOpenWindow={event => { const url = twitchPageUrl(event.nativeEvent.targetUrl); if (url) { setBrowsingTwitch(true); showPage(url); } }}
          onLoadStart={event => { setLoading(true); if (twitchPageUrl(event.nativeEvent.url)) setBrowsingTwitch(true); }}
          onLoadEnd={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
          onHttpError={event => { if (event.nativeEvent.url === location) { setFailed(true); setLoading(false); } }}
          onContentProcessDidTerminate={() => { setFailed(true); setLoading(false); }} />
      </>}
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e0e10' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderColor: '#35353b' },
  heading: { flex: 1, gap: 4 }, brand: { color: '#bf94ff', fontSize: 18, fontWeight: '800' },
  title: { color: '#efeff1', fontSize: 15, lineHeight: 21 }, creator: { color: '#c8c8ce', fontSize: 13 },
  button: { paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#6441a5', borderRadius: 8 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  returnButton: { alignSelf: 'flex-start', padding: 12 }, viewer: { flex: 1, backgroundColor: '#0e0e10' },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 10 },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24 },
});
