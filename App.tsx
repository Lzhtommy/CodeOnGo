import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createClient } from './src/lib/anthropic';
import { KEYS, deleteItem, getItem, setItem } from './src/lib/storage';
import { ChatScreen } from './src/ui/ChatScreen';
import { KeyEntryScreen } from './src/ui/KeyEntryScreen';
import { theme } from './src/ui/theme';

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getItem(KEYS.anthropicApiKey)
      .then(setApiKey)
      .finally(() => setLoaded(true));
  }, []);

  const client = useMemo(() => (apiKey ? createClient(apiKey) : null), [apiKey]);

  const saveKey = async (key: string) => {
    await setItem(KEYS.anthropicApiKey, key);
    setApiKey(key);
  };

  const resetKey = async () => {
    await deleteItem(KEYS.anthropicApiKey);
    setApiKey(null);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : client ? (
        <ChatScreen client={client} onResetKey={resetKey} />
      ) : (
        <KeyEntryScreen onSave={saveKey} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
