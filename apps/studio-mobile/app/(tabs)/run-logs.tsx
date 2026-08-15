import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { RunLogMeta } from "@agent-studio/agent-schema";
import { runLogsApi } from "../../src/api/run-logs";
import { getSelectedTeam } from "../../src/session";
import { colors } from "../../src/theme";

export default function RunLogsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<RunLogMeta[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const team = await getSelectedTeam();
      if (!team?.id) throw new Error("未选择团队");
      const res = await runLogsApi.list({ team_id: team.id, limit: 50 });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.wrap}>
      {busy && !items.length ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.run_id}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
          refreshing={busy}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>{error || "暂无运行日志"}</Text>
          }
          renderItem={({ item }) => {
            const runId = item.run_id;
            return (
              <Pressable
                style={styles.card}
                onPress={() =>
                  router.push(`/run-log/${encodeURIComponent(runId)}`)
                }
              >
                <Text style={styles.title} numberOfLines={1}>
                  {item.title || item.work_order_id || runId}
                </Text>
                <Text style={styles.meta} numberOfLines={2}>
                  {runId}
                  {item.work_order_status
                    ? ` · ${item.work_order_status}`
                    : ""}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  title: { fontSize: 15, fontWeight: "600", color: colors.text },
  meta: { marginTop: 6, color: colors.muted, fontSize: 12 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
});
