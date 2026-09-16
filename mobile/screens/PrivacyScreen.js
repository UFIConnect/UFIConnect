import React from 'react';
import { ScrollView, View, Text, Switch, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { usePreferences } from '../context/PreferencesContext';
import { useAnalytics } from '../analytics/AnalyticsProvider';
import { useServiceMetrics } from '../analytics/ServiceMetricsProvider';
import { COLORS } from '../theme';

export default function PrivacyScreen() {
  const { preferences, ready, updatePreference, storageError } = usePreferences();
  const analytics = useAnalytics();
  const { performanceAvailable } = useServiceMetrics();
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <Text style={styles.heading} accessibilityRole="header">Data & privacy</Text>
    <View style={styles.card}>
      <Text style={styles.title}>Required service metrics</Text>
      <Text style={styles.body}>UFIConnect needs operational and security metrics to run the service. We also count visits to general app screens in daily totals. These usage counts contain no account or visitor ID, screen parameters, messages, searches, or other personal content.</Text>
      <Text style={styles.body}>The service receives connection information when you make a request. Aggregate usage counts do not store your IP address or identify individual visitors.</Text>
    </View>
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Data Saver</Text>
        <Switch accessibilityLabel="Data Saver" value={preferences.dataSaver} disabled={!ready}
          onValueChange={value => updatePreference('dataSaver', value)} />
      </View>
      <Text style={styles.body}>Load only the Feed section you open instead of downloading Groups, Social, and Jobs together. Applies on every connection.</Text>
      <Text style={styles.body}>This app displays text feeds and does not autoplay media. Roaming is controlled in your device's cellular settings; Data Saver does not change it.</Text>
    </View>
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Performance insights</Text>
        {performanceAvailable && <Switch accessibilityLabel="Performance insights" value={preferences.performanceInsights} disabled={!ready}
          onValueChange={value => updatePreference('performanceInsights', value)} />}
      </View>
      <Text style={styles.body}>{performanceAvailable
        ? 'Optional and off by default. Send counts of app errors with a fixed screen category and error code. No error messages, stack traces, account IDs, or personal content are sent.'
        : 'Error collection is unavailable in this app runtime.'}</Text>
    </View>
    <View style={styles.card}>
      <Text style={styles.title}>Google Analytics</Text>
      <Text style={styles.body}>{analytics.available
        ? `Optional browser analytics: ${analytics.consent === 'granted' ? 'allowed' : 'off'}. Google collection begins only with your permission and receives connection and device information.`
        : 'Unavailable in this native app. No Google Analytics data is collected. Optional Google Analytics is available in the web app.'}</Text>
      {analytics.available && <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={analytics.openPreferences}>
        <Text style={styles.buttonText}>Manage Google Analytics</Text>
      </TouchableOpacity>}
      {!!analytics.persistenceError && <Text accessibilityRole="alert" style={styles.error}>{analytics.persistenceError}</Text>}
    </View>
    <Text style={styles.body}>Preferences are saved on this device. Required aggregate screen counts continue when optional analytics and performance insights are off.</Text>
    {!!storageError && <Text accessibilityRole="alert" style={styles.error}>{storageError}</Text>}
    <TouchableOpacity accessibilityRole="link" style={styles.button} onPress={() => Linking.openURL('https://uficonnect.org/privacy')}>
      <Text style={styles.buttonText}>Read privacy policy</Text>
    </TouchableOpacity>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 20, gap: 16, maxWidth: 680, width: '100%', alignSelf: 'center' },
  heading: { fontSize: 25, fontWeight: '800', color: COLORS.text },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 9 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { fontSize: 17, fontWeight: '700', color: COLORS.text, flexShrink: 1 },
  body: { fontSize: 14, lineHeight: 21, color: COLORS.muted },
  button: { padding: 12, borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8, alignItems: 'center' },
  buttonText: { color: COLORS.primary, fontWeight: '700' },
  error: { color: COLORS.danger, fontSize: 14 },
});
