import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from './theme';

interface Props {
  title: string;
  content: string;
  onBack: () => void;
}

export function TextViewScreen({ title, content, onBack }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title.split('/').pop()}
        </Text>
        <View style={{ width: 48 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView horizontal>
          <Text style={styles.code}>{content}</Text>
        </ScrollView>
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
  headerTitle: { color: theme.text, fontSize: 15, fontWeight: '700', flex: 1, textAlign: 'center' },
  headerAction: { color: theme.textDim, fontSize: 15, width: 48 },
  content: { padding: 12 },
  code: { color: theme.text, fontFamily: theme.mono, fontSize: 12, lineHeight: 18 },
});
