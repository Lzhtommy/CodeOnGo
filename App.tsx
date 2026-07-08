import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createClient } from './src/lib/anthropic';
import { KEYS, deleteItem, getItem, setItem } from './src/lib/storage';
import type { Repo } from './src/lib/github';
import type { SessionSummary } from './src/lib/session';
import { ChatMode, ChatScreen } from './src/ui/ChatScreen';
import { DiffScreen } from './src/ui/DiffScreen';
import { KeyEntryScreen } from './src/ui/KeyEntryScreen';
import { PreviewScreen } from './src/ui/PreviewScreen';
import { RepoPickerScreen } from './src/ui/RepoPickerScreen';
import { SessionListScreen } from './src/ui/SessionListScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { TextViewScreen } from './src/ui/TextViewScreen';
import { theme } from './src/ui/theme';

type Route =
  | { name: 'list' }
  | { name: 'chat'; mode: ChatMode }
  | { name: 'settings' }
  | { name: 'repoPicker' }
  | { name: 'diff'; rawDiff: string; from: Route }
  | { name: 'preview'; html: string; from: Route }
  | { name: 'text'; title: string; content: string; from: Route };

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState<Route>({ name: 'list' });

  useEffect(() => {
    getItem(KEYS.anthropicApiKey)
      .then(setApiKey)
      .finally(() => setLoaded(true));
  }, []);

  const client = useMemo(() => (apiKey ? createClient(apiKey) : null), [apiKey]);

  const saveKey = async (key: string) => {
    await setItem(KEYS.anthropicApiKey, key);
    setApiKey(key);
    setRoute({ name: 'list' });
  };

  const resetKey = async () => {
    await deleteItem(KEYS.anthropicApiKey);
    setApiKey(null);
  };

  const openSession = (s: SessionSummary) =>
    setRoute({ name: 'chat', mode: { kind: 'existing', sessionId: s.id, title: s.title } });

  const selectRepo = (repo: Repo) =>
    setRoute({
      name: 'chat',
      mode: {
        kind: 'new-repo',
        repoFullName: repo.full_name,
        defaultBranch: repo.default_branch,
      },
    });

  const renderRoute = () => {
    if (!client) return null;
    switch (route.name) {
      case 'list':
        return (
          <SessionListScreen
            client={client}
            onOpenSession={openSession}
            onNewBlank={() => setRoute({ name: 'chat', mode: { kind: 'new-blank' } })}
            onNewRepo={() => setRoute({ name: 'repoPicker' })}
            onOpenSettings={() => setRoute({ name: 'settings' })}
          />
        );
      case 'chat':
        return (
          <ChatScreen
            client={client}
            mode={route.mode}
            onBack={() => setRoute({ name: 'list' })}
            onOpenDiff={(rawDiff) => setRoute({ name: 'diff', rawDiff, from: route })}
            onOpenPreview={(html) => setRoute({ name: 'preview', html, from: route })}
            onOpenText={(title, content) => setRoute({ name: 'text', title, content, from: route })}
            onSessionCreated={(sessionId, title) =>
              setRoute({ name: 'chat', mode: { kind: 'existing', sessionId, title } })
            }
          />
        );
      case 'settings':
        return <SettingsScreen onBack={() => setRoute({ name: 'list' })} onResetApiKey={resetKey} />;
      case 'repoPicker':
        return (
          <RepoPickerScreen
            onBack={() => setRoute({ name: 'list' })}
            onSelect={selectRepo}
            onNeedGitHub={() => setRoute({ name: 'settings' })}
          />
        );
      case 'diff':
        return <DiffScreen rawDiff={route.rawDiff} onBack={() => setRoute(route.from)} />;
      case 'preview':
        return <PreviewScreen html={route.html} onBack={() => setRoute(route.from)} />;
      case 'text':
        return (
          <TextViewScreen
            title={route.title}
            content={route.content}
            onBack={() => setRoute(route.from)}
          />
        );
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : client ? (
        renderRoute()
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
