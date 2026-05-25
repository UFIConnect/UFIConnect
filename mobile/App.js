import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, Button, FlatList, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import axios from 'axios';

const API_BASE = 'http://localhost:3000';

export default function App() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchGroups();
  }, []);

  const fetchGroups = async () => {
    try {
      const response = await axios.get(`${API_BASE}/groups`);
      setGroups(response.data.groups);
    } catch (error) {
      console.error('Failed to load groups', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>ProConnect</Text>
      <Text style={styles.subtitle}>Connect with professional groups and people.</Text>
      <Button title="Refresh groups" onPress={fetchGroups} />
      {loading ? (
        <Text style={styles.loading}>Loading groups...</Text>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.groupName}>{item.name}</Text>
              <Text style={styles.groupDescription}>{item.description}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No groups available yet.</Text>}
        />
      )}
      <StatusBar style="auto" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingTop: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
    color: '#444',
  },
  loading: {
    marginTop: 20,
    color: '#666',
  },
  card: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f5f6fb',
  },
  groupName: {
    fontSize: 18,
    fontWeight: '700',
  },
  groupDescription: {
    marginTop: 6,
    color: '#555',
  },
  empty: {
    marginTop: 20,
    color: '#999',
    textAlign: 'center',
  },
});
