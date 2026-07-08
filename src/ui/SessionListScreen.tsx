import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type Anthropic from '@anthropic-ai/sdk';
import { SessionSummary, listSessions } from '../lib/session';
import { theme } from './theme';

interface Props {
  client: Anthropic;
  onOpenSession: (session: SessionSummary) => void;
  onNewBlank: () => void;
  onNewRepo: () => void;
  onOpenSettings: () => void;
}

const STATUS_LABEL: Record<SessionSummary['status'], { text: string; color: string }> = {
  running: { text: '运行中', color: '#2f9e44' },
  rescheduling: { text: '调度中', color: '#e8a33d' },
  idle: { text: '空闲', color: theme.textDim },
  terminated: { text: '已终止', color: theme.danger },
};

export function SessionListScreen({
  client,
  onOpenSession,
  onNewBlank,
  onNewRepo,
  onOpenSettings,
}: Props) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setSessions(await listSessions(client));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CodeOnGo</Text>
        <TouchableOpacity onPress={onOpenSettings}>
          <Text style={styles.headerAction}>设置</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.newRow}>
        <TouchableOpacity style={styles.newButton} onPress={onNewBlank}>
          <Text style={styles.newButtonText}>＋ 空白项目</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.newButton, styles.newButtonAlt]} onPress={onNewRepo}>
          <Text style={styles.newButtonText}>＋ GitHub 仓库</Text>
        </TouchableOpacity>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {sessions === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>还没有会话，从上面新建一个开始 vibe</Text>
          }
          renderItem={({ item }) => {
            const status = STATUS_LABEL[item.status];
            return (
              <TouchableOpacity style={styles.card} onPress={() => onOpenSession(item)}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.title || '（无标题）'}
                  </Text>
                  <View style={[styles.badge, { borderColor: status.color }]}>
                    <Text style={[styles.badgeText, { color: status.color }]}>{status.text}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {new Date(item.updatedAt).toLocaleString('zh-CN', { hour12: false })}
                </Text>
              </TouchableOpacity>
            );
          }}
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
  headerTitle: { color: theme.text, fontSize: 20, fontWeight: '700' },
  headerAction: { color: theme.textDim, fontSize: 14 },
  newRow: { flexDirection: 'row', gap: 10, padding: 12 },
  newButton: {
    flex: 1,
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  newButtonAlt: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  newButtonText: { color: theme.text, fontWeight: '600', fontSize: 14 },
  listContent: { padding: 12, gap: 8 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: theme.text, fontSize: 15, fontWeight: '600', flex: 1 },
  badge: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 11 },
  cardMeta: { color: theme.textDim, fontSize: 12, marginTop: 6 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  empty: { color: theme.textDim, textAlign: 'center', marginTop: 48, fontSize: 14 },
  error: { color: theme.danger, paddingHorizontal: 16, paddingBottom: 8, fontSize: 13 },
});
