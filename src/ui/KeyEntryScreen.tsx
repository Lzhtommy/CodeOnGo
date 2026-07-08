import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { theme } from './theme';

interface Props {
  onSave: (apiKey: string) => void;
}

export function KeyEntryScreen({ onSave }: Props) {
  const [key, setKey] = useState('');
  const valid = key.trim().startsWith('sk-ant-');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>CodeOnGo</Text>
        <Text style={styles.subtitle}>随时随地 vibe coding</Text>
        <Text style={styles.label}>
          填入你的 Anthropic API Key（仅存本机安全存储，直连 Anthropic，不经过任何第三方服务器）
        </Text>
        <TextInput
          style={styles.input}
          value={key}
          onChangeText={setKey}
          placeholder="sk-ant-..."
          placeholderTextColor={theme.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
        <TouchableOpacity
          style={[styles.button, !valid && styles.buttonDisabled]}
          disabled={!valid}
          onPress={() => onSave(key.trim())}
        >
          <Text style={styles.buttonText}>开始</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 24, gap: 12 },
  title: { color: theme.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: theme.accent, fontSize: 14, marginBottom: 8 },
  label: { color: theme.textDim, fontSize: 13, lineHeight: 18 },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    color: theme.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: theme.mono,
    fontSize: 14,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
