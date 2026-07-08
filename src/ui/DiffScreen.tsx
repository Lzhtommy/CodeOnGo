import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FileDiff, MAX_RENDER_LINES, parseUnifiedDiff } from '../lib/diff';
import { theme } from './theme';

interface Props {
  rawDiff: string;
  onBack: () => void;
}

const LINE_COLORS: Record<string, { bg: string; fg: string }> = {
  add: { bg: 'rgba(47,158,68,0.14)', fg: '#7bd88f' },
  del: { bg: 'rgba(229,72,77,0.14)', fg: '#ff8a8e' },
  hunk: { bg: 'rgba(120,130,160,0.15)', fg: theme.textDim },
  context: { bg: 'transparent', fg: theme.textDim },
};

function FileSection({ file }: { file: FileDiff }) {
  const [expanded, setExpanded] = useState(true);
  const truncated = file.lines.length > MAX_RENDER_LINES;
  const lines = truncated ? file.lines.slice(0, MAX_RENDER_LINES) : file.lines;

  return (
    <View style={styles.fileCard}>
      <TouchableOpacity style={styles.fileHeader} onPress={() => setExpanded((e) => !e)}>
        <Text style={styles.fileName} numberOfLines={1}>
          {expanded ? '▾' : '▸'} {file.path}
        </Text>
        <Text style={styles.fileStat}>
          <Text style={{ color: '#7bd88f' }}>+{file.additions}</Text>{' '}
          <Text style={{ color: '#ff8a8e' }}>-{file.deletions}</Text>
        </Text>
      </TouchableOpacity>
      {expanded &&
        (file.isBinary ? (
          <Text style={styles.binaryNote}>二进制文件，无文本 diff</Text>
        ) : (
          <ScrollView horizontal style={styles.codeScroll}>
            <View>
              {lines.map((line, i) => (
                <Text
                  key={i}
                  style={[
                    styles.codeLine,
                    { backgroundColor: LINE_COLORS[line.kind].bg, color: LINE_COLORS[line.kind].fg },
                  ]}
                >
                  {line.text || ' '}
                </Text>
              ))}
              {truncated && (
                <Text style={styles.binaryNote}>
                  （超长 diff，已截断至 {MAX_RENDER_LINES} 行）
                </Text>
              )}
            </View>
          </ScrollView>
        ))}
    </View>
  );
}

export function DiffScreen({ rawDiff, onBack }: Props) {
  const files = useMemo(() => parseUnifiedDiff(rawDiff), [rawDiff]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>改动（{files.length} 个文件）</Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {files.length === 0 ? (
          <Text style={styles.binaryNote}>diff 为空或无法解析</Text>
        ) : (
          files.map((f) => <FileSection key={f.path} file={f} />)
        )}
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
  headerTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  headerAction: { color: theme.textDim, fontSize: 15, width: 48 },
  content: { padding: 12, paddingBottom: 32 },
  fileCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
  },
  fileHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
  },
  fileName: { color: theme.text, fontSize: 13, fontWeight: '600', flex: 1, marginRight: 8 },
  fileStat: { fontSize: 12, fontFamily: theme.mono },
  codeScroll: { borderTopWidth: 1, borderTopColor: theme.border },
  codeLine: { fontFamily: theme.mono, fontSize: 11, lineHeight: 16, paddingHorizontal: 10 },
  binaryNote: { color: theme.textDim, fontSize: 12, padding: 12 },
});
