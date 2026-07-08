import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Repo, getToken, listRepos } from '../lib/github';
import { theme } from './theme';

interface Props {
  onBack: () => void;
  onSelect: (repo: Repo) => void;
  onNeedGitHub: () => void; // 未连接 GitHub 时跳设置
}

export function RepoPickerScreen({ onBack, onSelect, onNeedGitHub }: Props) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const token = await getToken();
      if (!token) {
        onNeedGitHub();
        return;
      }
      try {
        setRepos(await listRepos(token));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [onNeedGitHub]);

  const filtered =
    repos?.filter((r) => r.full_name.toLowerCase().includes(query.trim().toLowerCase())) ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>选择仓库</Text>
        <View style={{ width: 48 }} />
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="搜索仓库…"
        placeholderTextColor={theme.textDim}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {repos === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => r.full_name}
          ListEmptyComponent={<Text style={styles.empty}>没有匹配的仓库</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => onSelect(item)}>
              <Text style={styles.cardTitle}>
                {item.full_name}
                {item.private ? '  🔒' : ''}
              </Text>
              <Text style={styles.cardMeta}>
                默认分支 {item.default_branch} · 最近推送{' '}
                {new Date(item.pushed_at).toLocaleDateString('zh-CN')}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerTitle: { color: theme.text, fontSize: 17, fontWeight: '700' },
  headerAction: { color: theme.textDim, fontSize: 15, width: 48 },
  search: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    margin: 12,
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 12, paddingBottom: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 12, padding: 14, marginBottom: 8 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '600' },
  cardMeta: { color: theme.textDim, fontSize: 12, marginTop: 4 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: theme.textDim, textAlign: 'center', marginTop: 48 },
  error: { color: theme.danger, paddingHorizontal: 16, fontSize: 13 },
});
