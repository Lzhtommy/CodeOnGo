import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureBootstrap } from '../lib/bootstrap';
import {
  createBlankSession,
  interrupt,
  runTurn,
  SessionEvent,
} from '../lib/session';
import { theme } from './theme';

type ItemKind = 'user' | 'agent' | 'thinking' | 'tool' | 'error' | 'status';

interface ChatItem {
  id: string;
  kind: ItemKind;
  text: string;
}

/** 从事件 content 块里抽出可显示文本（兼容 text / thinking 块） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(ev: any): string {
  const blocks = Array.isArray(ev.content) ? ev.content : [];
  const parts = blocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b?.text ?? b?.thinking ?? '')
    .filter(Boolean);
  if (parts.length) return parts.join('\n');
  return typeof ev.thinking === 'string' ? ev.thinking : '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarizeToolInput(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const s = JSON.stringify(input);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function eventToItem(ev: SessionEvent): ChatItem | null {
  switch (ev.type) {
    case 'agent.message': {
      const text = extractText(ev);
      return text ? { id: ev.id, kind: 'agent', text } : null;
    }
    case 'agent.thinking': {
      const text = extractText(ev);
      return text ? { id: ev.id, kind: 'thinking', text } : null;
    }
    case 'agent.tool_use':
      return {
        id: ev.id,
        kind: 'tool',
        text: `${ev.name ?? 'tool'}  ${summarizeToolInput(ev.input)}`,
      };
    case 'session.error':
      return {
        id: ev.id ?? `err-${Date.now()}`,
        kind: 'error',
        text: ev.error?.message ?? JSON.stringify(ev.error ?? ev),
      };
    default:
      return null; // tool_result / span.* / status 事件不进消息列表
  }
}

interface Props {
  client: Anthropic;
  onResetKey: () => void;
}

export function ChatScreen({ client, onResetKey }: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());

  const sessionIdRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef(false);
  const listRef = useRef<FlatList>(null);

  const appendItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const onEvent = useCallback(
    (ev: SessionEvent) => {
      const item = eventToItem(ev);
      if (item) appendItem(item);
    },
    [appendItem],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput('');
    setRunning(true);
    cancelledRef.current = false;
    appendItem({ id: `local-${Date.now()}`, kind: 'user', text });

    try {
      if (!sessionIdRef.current) {
        setStatusLine('正在初始化 agent 与云端工作区…');
        const { agentId, environmentId } = await ensureBootstrap(client);
        setStatusLine('正在创建 session…');
        sessionIdRef.current = await createBlankSession(
          client,
          agentId,
          environmentId,
          text.slice(0, 60),
        );
      }
      setStatusLine('agent 工作中…');
      const outcome = await runTurn({
        client,
        sessionId: sessionIdRef.current,
        seen: seenRef.current,
        onEvent,
        text,
        isCancelled: () => cancelledRef.current,
      });
      setStatusLine(outcome === 'terminated' ? 'session 已终止' : null);
    } catch (err) {
      appendItem({
        id: `local-err-${Date.now()}`,
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      setStatusLine(null);
    } finally {
      setRunning(false);
    }
  }, [appendItem, client, input, onEvent, running]);

  const onInterrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await interrupt(client, sessionIdRef.current);
      setStatusLine('已发送中断…');
    } catch {
      // interrupt 失败不阻塞 UI
    }
  }, [client]);

  const renderItem = useCallback(
    ({ item }: { item: ChatItem }) => {
      if (item.kind === 'thinking') {
        const expanded = expandedThinking.has(item.id);
        return (
          <TouchableOpacity
            style={[styles.bubble, styles.thinking]}
            onPress={() =>
              setExpandedThinking((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              })
            }
          >
            <Text style={styles.thinkingLabel}>{expanded ? '▾ 思考过程' : '▸ 思考过程'}</Text>
            {expanded && <Text style={styles.thinkingText}>{item.text}</Text>}
          </TouchableOpacity>
        );
      }
      const bubbleStyle = [
        styles.bubble,
        item.kind === 'user' && styles.user,
        item.kind === 'tool' && styles.tool,
        item.kind === 'error' && styles.error,
      ];
      const textStyle = [
        styles.bubbleText,
        item.kind === 'tool' && styles.toolText,
        item.kind === 'error' && styles.errorText,
      ];
      return (
        <View style={bubbleStyle}>
          {item.kind === 'tool' && <Text style={styles.toolBadge}>⚒</Text>}
          <Text style={textStyle}>{item.text}</Text>
        </View>
      );
    },
    [expandedThinking],
  );

  const keyExtractor = useMemo(() => (item: ChatItem, index: number) => `${item.id}-${index}`, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>CodeOnGo</Text>
        <TouchableOpacity onPress={onResetKey}>
          <Text style={styles.headerAction}>重置 Key</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
      />

      {statusLine && (
        <View style={styles.statusRow}>
          {running && <ActivityIndicator size="small" color={theme.accent} />}
          <Text style={styles.statusText}>{statusLine}</Text>
          {running && (
            <TouchableOpacity style={styles.interruptButton} onPress={onInterrupt}>
              <Text style={styles.interruptText}>中断</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder={running ? 'agent 工作中…' : '想 vibe 点什么？'}
          placeholderTextColor={theme.textDim}
          editable={!running}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, (running || !input.trim()) && styles.sendDisabled]}
          disabled={running || !input.trim()}
          onPress={send}
        >
          <Text style={styles.sendText}>发送</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
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
  headerAction: { color: theme.textDim, fontSize: 13 },
  list: { flex: 1 },
  listContent: { padding: 12, gap: 8 },
  bubble: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    maxWidth: '92%',
    alignSelf: 'flex-start',
  },
  user: { backgroundColor: theme.accent, alignSelf: 'flex-end' },
  tool: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.border,
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
  },
  error: { borderWidth: 1, borderColor: theme.danger },
  bubbleText: { color: theme.text, fontSize: 15, lineHeight: 21 },
  toolBadge: { color: theme.textDim, fontSize: 13 },
  toolText: { color: theme.textDim, fontSize: 12, fontFamily: theme.mono, flexShrink: 1 },
  errorText: { color: theme.danger },
  thinking: { backgroundColor: 'transparent', paddingVertical: 6 },
  thinkingLabel: { color: theme.textDim, fontSize: 13 },
  thinkingText: { color: theme.textDim, fontSize: 13, lineHeight: 19, marginTop: 6 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  statusText: { color: theme.textDim, fontSize: 13, flex: 1 },
  interruptButton: {
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  interruptText: { color: theme.danger, fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  input: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 12,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
