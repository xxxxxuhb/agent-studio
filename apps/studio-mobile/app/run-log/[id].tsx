import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RunLogEntry, RunLogMeta } from "@agent-studio/agent-schema";
import {
  runLogsApi,
  type RunArtifactListItem,
} from "../../src/api/run-logs";
import { MarkdownBody } from "../../src/components/MarkdownBody";
import { colors } from "../../src/theme";

export default function RunLogDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const runId = id ? decodeURIComponent(id) : "";
  const [meta, setMeta] = useState<RunLogMeta | null>(null);
  const [entries, setEntries] = useState<RunLogEntry[]>([]);
  const [artifacts, setArtifacts] = useState<RunArtifactListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"logs" | "artifacts">("logs");

  const load = useCallback(async () => {
    if (!runId) return;
    setBusy(true);
    setError("");
    try {
      const detail = await runLogsApi.get(runId);
      setMeta(detail.meta);
      setEntries(detail.entries.slice(-80));
      try {
        const arts = await runLogsApi.listArtifacts(runId);
        setArtifacts(arts.items || []);
      } catch {
        setArtifacts([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (busy && !meta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error && !meta) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={2}>
          {meta?.title || meta?.work_order_id || runId}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {runId}
          {meta?.work_order_status ? ` · ${meta.work_order_status}` : ""}
        </Text>
        <View style={styles.tabs}>
          <Pressable
            style={[styles.tab, tab === "logs" && styles.tabOn]}
            onPress={() => setTab("logs")}
          >
            <Text style={tab === "logs" ? styles.tabTextOn : styles.tabText}>
              日志
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, tab === "artifacts" && styles.tabOn]}
            onPress={() => setTab("artifacts")}
          >
            <Text
              style={tab === "artifacts" ? styles.tabTextOn : styles.tabText}
            >
              产物 ({artifacts.length})
            </Text>
          </Pressable>
        </View>
      </View>

      {tab === "logs" ? (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 40 }}
          refreshing={busy}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>暂无日志条目</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.entryMeta}>
                {[item.level, item.source, item.at].filter(Boolean).join(" · ")}
              </Text>
              <MarkdownBody content={item.message || item.event_type || ""} />
              {item.body?.trim() ? (
                <View style={styles.entryBody}>
                  <MarkdownBody content={item.body} />
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <FlatList
          data={artifacts}
          keyExtractor={(a) => a.name}
          contentContainerStyle={{ padding: 12, gap: 8, paddingBottom: 40 }}
          refreshing={busy}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>暂无产物（只读）</Text>
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() =>
                router.push({
                  pathname: "/artifact",
                  params: { runId, name: item.name },
                })
              }
            >
              <Text style={styles.artName}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.bytes} bytes
                {item.role ? ` · ${item.role}` : ""}
              </Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
    gap: 6,
  },
  title: { fontSize: 16, fontWeight: "700", color: colors.text },
  meta: { color: colors.muted, fontSize: 12 },
  tabs: { flexDirection: "row", gap: 8, marginTop: 6 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.bg,
  },
  tabOn: { backgroundColor: `${colors.primary}22` },
  tabText: { color: colors.muted, fontSize: 13 },
  tabTextOn: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  entryMeta: { color: colors.muted, fontSize: 11, marginBottom: 4 },
  entryBody: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  artName: { color: colors.text, fontWeight: "600", fontSize: 14 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  error: { color: colors.danger },
});
