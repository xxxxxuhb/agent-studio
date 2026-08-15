import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { BridgeExecutor } from "@agent-studio/agent-schema";
import { bridgesApi } from "../../src/api/bridges";
import { BRIDGE_STATUS_LABEL } from "../../src/labels";
import { getSelectedTeam } from "../../src/session";
import { colors } from "../../src/theme";

export default function BridgesScreen() {
  const [items, setItems] = useState<BridgeExecutor[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const team = await getSelectedTeam();
      if (!team?.id) throw new Error("未选择团队");
      const res = await bridgesApi.list({ team_id: team.id });
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
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
          refreshing={busy}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>{error || "暂无执行器"}</Text>
          }
          renderItem={({ item }) => {
            const st = BRIDGE_STATUS_LABEL[item.status] || {
              color: colors.muted,
              text: item.status,
            };
            return (
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.title}>{item.name || item.id}</Text>
                  <View
                    style={[styles.badge, { backgroundColor: `${st.color}22` }]}
                  >
                    <Text style={[styles.badgeText, { color: st.color }]}>
                      {st.text}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  {[item.driver, item.base_url].filter(Boolean).join(" · ")}
                </Text>
              </View>
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
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  meta: { marginTop: 8, color: colors.muted, fontSize: 12 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
});
