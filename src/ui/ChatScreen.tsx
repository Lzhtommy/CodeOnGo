import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type Anthropic from '@anthropic-ai/sdk';
import { ensureBootstrap } from '../lib/bootstrap';
import { ChatItem, detectPushedBranch, eventToItem } from '../lib/events';
import { createPullRequest, getToken } from '../lib/github';
import {
  OutputFile,
  downloadBase64,
  downloadText,
  findOutput,
  isTextFile,
  listOutputs,
} from '../lib/outputs';
import {
  SessionEvent,
  attachSession,
  createBlankSession,
  createRepoSession,
  interrupt,
  runTurn,
} from '../lib/session';
import { theme } from './theme';

export type ChatMode =
  | { kind: 'new-blank' }
  | { kind: 'new-repo'; repoFullName: string; defaultBranch: string }
  | { kind: 'existing'; sessionId: string; title: string | null };

interface RepoInfo {
  fullName: string;
  baseBranch: string;
}

interface Props {
  client: Anthropic;
  mode: ChatMode;
  onBack: () => void;
  onOpenDiff: (rawDiff: string) => void;
  onOpenPreview: (html: string) => void;
  onOpenText: (title: string, content: string) => void;
  /** 新建模式下 session 创建成功后上报，路由据此把当前页固化为 existing */
  onSessionCreated: (sessionId: string, title: string) => void;
}

export function ChatScreen({
  client,
  mode,
  onBack,
  onOpenDiff,
  onOpenPreview,
  onOpenText,
  onSessionCreated,
}: Props) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set());
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [outputsBusy, setOutputsBusy] = useState<string | null>(null);
  const [prBranch, setPrBranch] = useState<string | null>(null);
  const [prTitle, setPrTitle] = useState('');
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);

  const sessionIdRef = useRef<string | null>(mode.kind === 'existing' ? mode.sessionId : null);
  const repoRef = useRef<RepoInfo | null>(
    mode.kind === 'new-repo'
      ? { fullName: mode.repoFullName, baseBranch: mode.defaultBranch }
      : null,
  );
  const seenRef = useRef<Set<string>>(new Set());
  const cancelledRef = useRef(false);
  const consumingRef = useRef(false);
  const lastBranchRef = useRef<string | null>(null);
  const listRef = useRef<FlatList>(null);

  const appendItem = useCallback((item: ChatItem) => {
    setItems((prev) => [...prev, item]);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, []);

  const onEvent = useCallback(
    (ev: SessionEvent) => {
      const branch = detectPushedBranch(ev);
      if (branch) lastBranchRef.current = branch;
      const item = eventToItem(ev);
      if (item) appendItem(item);
    },
    [appendItem],
  );

  const refreshOutputs = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      setOutputs(await listOutputs(client, sessionIdRef.current, { retries: 2 }));
    } catch {
      // 产物拉取失败不打断主流程
    }
  }, [client]);

  const afterSettled = useCallback(async () => {
    await refreshOutputs();
    if (repoRef.current && lastBranchRef.current) {
      setPrBranch(lastBranchRef.current);
      setPrTitle(`CodeOnGo: ${lastBranchRef.current}`);
    }
  }, [refreshOutputs]);

  /** 打开历史 session / 回前台：consolidation 补齐并跟进 */
  const catchUp = useCallback(async () => {
    if (!sessionIdRef.current || consumingRef.current) return;
    consumingRef.current = true;
    try {
      const session = await client.beta.sessions.retrieve(sessionIdRef.current);
      // 补出仓库信息（历史 session 恢复 PR 能力）
      if (!repoRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repoRes = (session.resources as any[])?.find(
          (r) => r.type === 'github_repository',
        );
        if (repoRes?.url) {
          const fullName = repoRes.url.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
          repoRef.current = {
            fullName,
            baseBranch: repoRes.checkout?.name ?? 'main',
          };
        }
      }
      const wasRunning = session.status === 'running' || session.status === 'rescheduling';
      if (wasRunning) setRunning(true);
      setStatusLine(wasRunning ? 'agent 工作中…' : null);

      const outcome = await attachSession({
        client,
        sessionId: sessionIdRef.current,
        seen: seenRef.current,
        onEvent,
        isCancelled: () => cancelledRef.current,
      });
      setStatusLine(outcome === 'terminated' ? 'session 已终止' : null);
      await afterSettled();
    } catch (err) {
      appendItem({
        id: `local-err-${Date.now()}`,
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      consumingRef.current = false;
      setRunning(false);
    }
  }, [afterSettled, appendItem, client, onEvent]);

  // 初始化：历史 session 补历史；repo 模式立即创建（clone 阻塞期间给状态）
  useEffect(() => {
    cancelledRef.current = false;
    (async () => {
      if (mode.kind === 'existing') {
        setStatusLine('加载历史…');
        await catchUp();
      } else if (mode.kind === 'new-repo') {
        try {
          setStatusLine('初始化 agent…');
          const { agentId, environmentId } = await ensureBootstrap(client);
          const token = await getToken();
          if (!token) throw new Error('GitHub 未连接');
          setStatusLine(`挂载 ${mode.repoFullName}…（首次 clone 可能要一会儿）`);
          sessionIdRef.current = await createRepoSession(
            client,
            agentId,
            environmentId,
            { fullName: mode.repoFullName, defaultBranch: mode.defaultBranch },
            token,
            mode.repoFullName,
          );
          onSessionCreated(sessionIdRef.current, mode.repoFullName);
          setStatusLine(null);
        } catch (err) {
          appendItem({
            id: `local-err-${Date.now()}`,
            kind: 'error',
            text: err instanceof Error ? err.message : String(err),
          });
          setStatusLine(null);
        }
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AppState：回前台自动 catch up（issue #4）
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });
    return () => sub.remove();
  }, [catchUp]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running || consumingRef.current) return;
    setInput('');
    setRunning(true);
    consumingRef.current = true;
    cancelledRef.current = false;

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
        onSessionCreated(sessionIdRef.current, text.slice(0, 60));
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
      await afterSettled();
    } catch (err) {
      appendItem({
        id: `local-err-${Date.now()}`,
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
      setStatusLine(null);
    } finally {
      consumingRef.current = false;
      setRunning(false);
    }
  }, [afterSettled, appendItem, client, input, onEvent, running]);

  const onInterrupt = useCallback(async () => {
    if (!sessionIdRef.current) return;
    try {
      await interrupt(client, sessionIdRef.current);
      setStatusLine('已发送中断…');
    } catch {
      // interrupt 失败不阻塞 UI
    }
  }, [client]);

  const openOutput = useCallback(
    async (file: OutputFile) => {
      setOutputsBusy(file.id);
      try {
        if (file.filename.endsWith('changes.diff')) {
          onOpenDiff(await downloadText(client, file.id));
        } else if (file.filename.endsWith('preview.html')) {
          onOpenPreview(await downloadText(client, file.id));
        } else if (isTextFile(file)) {
          onOpenText(file.filename, await downloadText(client, file.id));
        } else {
          const b64 = await downloadBase64(client, file.id);
          await Share.share({
            url: `data:${file.mimeType ?? 'application/octet-stream'};base64,${b64}`,
            title: file.filename,
          });
        }
      } catch (err) {
        Alert.alert('打开失败', err instanceof Error ? err.message : String(err));
      } finally {
        setOutputsBusy(null);
      }
    },
    [client, onOpenDiff, onOpenPreview, onOpenText],
  );

  const createPr = useCallback(async () => {
    if (!repoRef.current || !prBranch) return;
    setPrBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('GitHub 未连接');
      const pr = await createPullRequest(token, repoRef.current.fullName, {
        title: prTitle.trim() || `CodeOnGo: ${prBranch}`,
        body: '由 CodeOnGo 发起的改动。',
        head: prBranch,
        base: repoRef.current.baseBranch,
      });
      setPrUrl(pr.html_url);
      setPrBranch(null);
    } catch (err) {
      Alert.alert('创建 PR 失败', err instanceof Error ? err.message : String(err));
    } finally {
      setPrBusy(false);
    }
  }, [prBranch, prTitle]);

  const diffFile = findOutput(outputs, 'changes.diff');
  const previewFile = findOutput(outputs, 'preview.html');
  const otherFiles = outputs.filter((f) => f !== diffFile && f !== previewFile);

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

  const title =
    mode.kind === 'existing'
      ? mode.title || 'Session'
      : mode.kind === 'new-repo'
        ? mode.repoFullName
        : '新会话';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 48 }} />
      </View>

      <FlatList
        ref={listRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        data={items}
        renderItem={renderItem}
        keyExtractor={(item, index) => `${item.id}-${index}`}
      />

      {/* 产物区（issue #6/#7/#8 入口） */}
      {(outputs.length > 0 || prBranch || prUrl) && (
        <View style={styles.artifacts}>
          {diffFile && (
            <TouchableOpacity
              style={styles.artifactChip}
              onPress={() => openOutput(diffFile)}
              disabled={outputsBusy === diffFile.id}
            >
              <Text style={styles.artifactChipText}>
                {outputsBusy === diffFile.id ? '加载中…' : '📝 查看改动'}
              </Text>
            </TouchableOpacity>
          )}
          {previewFile && (
            <TouchableOpacity
              style={styles.artifactChip}
              onPress={() => openOutput(previewFile)}
              disabled={outputsBusy === previewFile.id}
            >
              <Text style={styles.artifactChipText}>
                {outputsBusy === previewFile.id ? '加载中…' : '▶️ 预览'}
              </Text>
            </TouchableOpacity>
          )}
          {otherFiles.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={styles.artifactChip}
              onPress={() => openOutput(f)}
              disabled={outputsBusy === f.id}
            >
              <Text style={styles.artifactChipText}>
                {outputsBusy === f.id ? '加载中…' : `📄 ${f.filename.split('/').pop()}`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* PR 确认卡片（issue #9）——开 PR 必须用户显式确认 */}
      {prBranch && (
        <View style={styles.prCard}>
          <Text style={styles.prLabel}>agent 已推送分支 {prBranch}</Text>
          <TextInput
            style={styles.prInput}
            value={prTitle}
            onChangeText={setPrTitle}
            placeholder="PR 标题"
            placeholderTextColor={theme.textDim}
          />
          <View style={styles.prActions}>
            <TouchableOpacity style={styles.prGhost} onPress={() => setPrBranch(null)}>
              <Text style={styles.prGhostText}>忽略</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.prButton} onPress={createPr} disabled={prBusy}>
              {prBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.prButtonText}>创建 Pull Request</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
      {prUrl && (
        <TouchableOpacity style={styles.prLink} onPress={() => Linking.openURL(prUrl)}>
          <Text style={styles.prLinkText}>✅ PR 已创建，点击查看</Text>
        </TouchableOpacity>
      )}

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
  headerTitle: { color: theme.text, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  headerAction: { color: theme.textDim, fontSize: 15, width: 48 },
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
  artifacts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  artifactChip: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: theme.border,
  },
  artifactChipText: { color: theme.text, fontSize: 13 },
  prCard: {
    margin: 12,
    marginTop: 4,
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  prLabel: { color: theme.text, fontSize: 13, fontWeight: '600' },
  prInput: {
    backgroundColor: theme.bg,
    borderRadius: 8,
    color: theme.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  prActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  prGhost: { paddingVertical: 8, paddingHorizontal: 12 },
  prGhostText: { color: theme.textDim, fontSize: 13 },
  prButton: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  prButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  prLink: { marginHorizontal: 12, marginBottom: 8 },
  prLinkText: { color: '#7bd88f', fontSize: 13, fontWeight: '600' },
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
