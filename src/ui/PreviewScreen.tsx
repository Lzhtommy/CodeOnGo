import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { theme } from './theme';

interface Props {
  html: string;
  onBack: () => void;
}

/** preview.html 的内嵌渲染。约定为自包含单文件（inline 全部 JS/CSS），离线可用。 */
export function PreviewScreen({ html, onBack }: Props) {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.headerAction}>‹ 返回</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>预览</Text>
        <TouchableOpacity onPress={() => setReloadKey((k) => k + 1)}>
          <Text style={styles.headerAction}>刷新</Text>
        </TouchableOpacity>
      </View>
      <WebView
        key={reloadKey}
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html }}
        javaScriptEnabled
        domStorageEnabled
      />
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
  headerAction: { color: theme.textDim, fontSize: 15, minWidth: 48 },
  webview: { flex: 1, backgroundColor: '#fff' },
});
