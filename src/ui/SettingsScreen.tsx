import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  GitHubUser,
  disconnect,
  getToken,
  githubClientId,
  pollDeviceFlow,
  saveToken,
  startDeviceFlow,
  validateToken,
} from '../lib/github';
import { KEYS, getItem, setItem, deleteItem } from '../lib/storage';
import { theme } from './theme';

interface Props {
  onBack: () => void;
  onResetApiKey: () => void;
}

export function SettingsScreen({ onBack, onResetApiKey }: Props) {
  // 自定义指令
  const [instructions, setInstructions] = useState('');
  const [instructionsSaved, setInstructionsSaved] = useState(false);

  // GitHub
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [patInput, setPatInput] = useState('');
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getItem(KEYS.customInstructions).then((v) => setInstructions(v ?? ''));
    (async () => {
      const token = await getToken();
      if (token) {
        try {
          setGhUser(await validateToken(token));
        } catch {
          setGhUser(null);
        }
      }
      setGhLoading(false);
    })();
  }, []);

  const saveInstructions = async () => {
    const v = instructions.trim();
    if (v) await setItem(KEYS.customInstructions, v);
    else await deleteItem(KEYS.customInstructions);
    setInstructionsSaved(true);
    setTimeout(() => setInstructionsSaved(false), 2000);
  };

  const connectWithPat = async () => {
    const token = patInput.trim();
    if (!token) return;
    setBusy(true);
    try {
      setGhUser(await saveToken(token));
      setPatInput('');
    } catch (err) {
      Alert.alert('连接失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const connectWithDeviceFlow = async () => {
    setBusy(true);
    try {
      const device = await startDeviceFlow();
      setDeviceCode(device.user_code);
      Linking.openURL(device.verification_uri);
      const token = await pollDeviceFlow(device, () => false);
      setGhUser(await saveToken(token));
    } catch (err) {
      Alert.alert('授权失败', err instanceof Error ? err.message : String(err));
    } finally {
      setDeviceCode(null);
      setBusy(false);
    }
  };

  const disconnectGitHub = async () => {
    await disconnect();
    setGhUser(null);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>设置</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* 自定义指令 */}
        <Text style={styles.sectionTitle}>自定义指令</Text>
        <Text style={styles.sectionHint}>
          拼入 agent 的 system prompt（如"回复永远用中文"）。保存后对新建的 session 生效。
        </Text>
        <TextInput
          style={styles.textArea}
          value={instructions}
          onChangeText={setInstructions}
          placeholder="留空则不附加任何指令"
          placeholderTextColor={theme.textDim}
          multiline
        />
        <TouchableOpacity style={styles.button} onPress={saveInstructions}>
          <Text style={styles.buttonText}>{instructionsSaved ? '已保存 ✓' : '保存指令'}</Text>
        </TouchableOpacity>

        {/* GitHub */}
        <Text style={styles.sectionTitle}>GitHub</Text>
        {ghLoading ? (
          <ActivityIndicator color={theme.accent} />
        ) : ghUser ? (
          <View style={styles.ghConnected}>
            <Text style={styles.ghUser}>已连接：{ghUser.login}</Text>
            <TouchableOpacity onPress={disconnectGitHub}>
              <Text style={styles.dangerText}>断开</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {githubClientId() ? (
              <TouchableOpacity
                style={styles.button}
                onPress={connectWithDeviceFlow}
                disabled={busy}
              >
                <Text style={styles.buttonText}>
                  {deviceCode ? `在浏览器输入代码：${deviceCode}` : '通过 GitHub 授权连接'}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.sectionHint}>
                （OAuth 一键授权待配置 client_id，先用下方 PAT 连接）
              </Text>
            )}
            <Text style={styles.sectionHint}>
              手填 Personal Access Token（fine-grained，需要 Contents 读写权限）：
            </Text>
            <TextInput
              style={styles.input}
              value={patInput}
              onChangeText={setPatInput}
              placeholder="github_pat_... 或 ghp_..."
              placeholderTextColor={theme.textDim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.button, (!patInput.trim() || busy) && styles.buttonDisabled]}
              onPress={connectWithPat}
              disabled={!patInput.trim() || busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>连接</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* API Key */}
        <Text style={styles.sectionTitle}>Anthropic API Key</Text>
        <TouchableOpacity style={[styles.button, styles.dangerButton]} onPress={onResetApiKey}>
          <Text style={styles.dangerText}>重置 API Key</Text>
        </TouchableOpacity>
      </ScrollView>
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
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginTop: 16 },
  sectionHint: { color: theme.textDim, fontSize: 13, lineHeight: 18 },
  textArea: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    color: theme.text,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  input: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: 13,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  dangerButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.danger },
  dangerText: { color: theme.danger, fontWeight: '600', fontSize: 14 },
  ghConnected: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 14,
  },
  ghUser: { color: theme.text, fontSize: 14, fontWeight: '600' },
});
