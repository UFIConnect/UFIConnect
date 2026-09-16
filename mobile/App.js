import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './context/AuthContext';
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import OpportunitiesScreen from './screens/OpportunitiesScreen';
import GroupsScreen from './screens/GroupsScreen';
import GroupDetailScreen from './screens/GroupDetailScreen';
import FeedScreen from './screens/FeedScreen';
import MessagesScreen from './screens/MessagesScreen';
import ConversationScreen from './screens/ConversationScreen';
import ProfileScreen from './screens/ProfileScreen';
import ConnectedAccountsScreen from './screens/ConnectedAccountsScreen';
import SecurityScreen from './screens/SecurityScreen';
import { COLORS } from './theme';
import AnalyticsProvider, { useAnalytics } from './analytics/AnalyticsProvider';

const RootStack  = createNativeStackNavigator();
const Tab        = createBottomTabNavigator();
const ExploreStack  = createNativeStackNavigator();
const DiscoverStack = createNativeStackNavigator();
const MessagesStack = createNativeStackNavigator();
const ProfileStack  = createNativeStackNavigator();

const NAV_OPTS = {
  headerStyle: { backgroundColor: '#fff' },
  headerTitleStyle: { fontWeight: '900', fontSize: 18, color: COLORS.text },
  headerShadowVisible: false,
  headerTintColor: COLORS.primary,
};

// Opportunities + nothing to push into yet (self-contained)
function ExploreNavigator() {
  return (
    <ExploreStack.Navigator screenOptions={NAV_OPTS}>
      <ExploreStack.Screen name="Opportunities" component={OpportunitiesScreen} options={{ title: 'Explore' }} />
    </ExploreStack.Navigator>
  );
}

// Groups → Group detail
function DiscoverNavigator() {
  return (
    <DiscoverStack.Navigator screenOptions={NAV_OPTS}>
      <DiscoverStack.Screen name="Groups" component={GroupsScreen} options={{ title: 'UFconnect' }} />
      <DiscoverStack.Screen
        name="GroupDetail"
        component={GroupDetailScreen}
        options={({ route }) => ({ title: route.params?.group?.name || 'Group' })}
      />
    </DiscoverStack.Navigator>
  );
}

// Conversation list → individual chat
function MessagesNavigator() {
  return (
    <MessagesStack.Navigator screenOptions={NAV_OPTS}>
      <MessagesStack.Screen name="MessagesList" component={MessagesScreen} options={{ headerShown: false }} />
      <MessagesStack.Screen name="Conversation" component={ConversationScreen} options={{ title: '' }} />
    </MessagesStack.Navigator>
  );
}

// Profile → Connected accounts
function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={NAV_OPTS}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={{ title: 'Profile' }} />
      <ProfileStack.Screen name="ConnectedAccounts" component={ConnectedAccountsScreen} options={{ title: 'Connected Accounts' }} />
      <ProfileStack.Screen name="Security" component={SecurityScreen} options={{ title: 'Security' }} />
    </ProfileStack.Navigator>
  );
}

function TabIcon({ icon, focused }) {
  return <Text style={{ fontSize: 21, opacity: focused ? 1 : 0.4 }}>{icon}</Text>;
}

function AppTabs() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle: { backgroundColor: '#fff', borderTopColor: COLORS.border, height: 60 + insets.bottom, paddingBottom: Math.max(8, insets.bottom) },
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: COLORS.muted,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '700' },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Explore"
        component={ExploreNavigator}
        options={{ title: 'Explore', tabBarIcon: ({ focused }) => <TabIcon icon="🌐" focused={focused} /> }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverNavigator}
        options={{ title: 'Groups', tabBarIcon: ({ focused }) => <TabIcon icon="🔍" focused={focused} /> }}
      />
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{ title: 'Feed', tabBarIcon: ({ focused }) => <TabIcon icon="📰" focused={focused} /> }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesNavigator}
        options={{ title: 'Messages', tabBarIcon: ({ focused }) => <TabIcon icon="💬" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileNavigator}
        options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabIcon icon="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { token, loading, onboardingComplete } = useAuth();

  if (loading) {
    return (
      <View style={styles.splash}>
        <Text style={styles.splashLogo}>UFconnect</Text>
        <ActivityIndicator color={COLORS.primary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false }}>
      {!token ? (
        <>
          <RootStack.Screen name="Login" component={LoginScreen} />
          <RootStack.Screen name="Register" component={RegisterScreen} />
        </>
      ) : !onboardingComplete ? (
        <RootStack.Screen name="Onboarding" component={OnboardingScreen} options={{ gestureEnabled: false }} />
      ) : (
        <RootStack.Screen name="Main" component={AppTabs} />
      )}
    </RootStack.Navigator>
  );
}

function TrackedNavigation() {
  const navigationRef = React.useRef(null);
  const { trackScreen } = useAnalytics();
  const trackCurrentScreen = () => {
    const route = navigationRef.current?.getCurrentRoute();
    trackScreen(route?.name, route?.key);
  };
  return (
    <NavigationContainer ref={navigationRef} onReady={trackCurrentScreen} onStateChange={trackCurrentScreen}>
      <StatusBar style="dark" />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AnalyticsProvider>
        <AuthProvider>
          <TrackedNavigation />
        </AuthProvider>
      </AnalyticsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  splashLogo: { fontSize: 38, fontWeight: '900', color: COLORS.primary, letterSpacing: -1 },
});
