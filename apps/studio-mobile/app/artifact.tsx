import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { runLogsApi } from "../src/api/run-logs";
import {
  MarkdownBody,
  shouldRenderMarkdown,
} from "../src/components/MarkdownBody";
import { colors } from "../src/theme";

export default function ArtifactScreen() {
  const { runId, name } = useLocalSearchParams<{
    runId: string;
    name: string;
  }>();
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState("");
  const [meta, setMeta] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId || !name) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await runLogsApi.readArtifact(runId, name);
        if (cancelled) return;
        setContent(res.content || "");
        setContentType(res.content_type || "");
        setMeta(`${res.content_type || "text"} · ${res.bytes} bytes`);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "读取失败");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, name]);

  if (busy) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  const asMd = shouldRenderMarkdown(
    `${name || ""} ${contentType}`,
    content,
  );

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
    >
      <Text style={styles.title}>{name}</Text>
      <Text style={styles.meta}>{meta}</Text>
      <View style={styles.card}>
        {content ? (
          <MarkdownBody content={content} forceCode={!asMd} />
        ) : (
          <Text style={styles.empty}>(空)</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
  },
  empty: { color: colors.muted },
  error: { color: colors.danger },
});
