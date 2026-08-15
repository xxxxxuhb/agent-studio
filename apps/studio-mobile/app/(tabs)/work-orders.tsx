import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { WorkOrder } from "@agent-studio/agent-schema";
import { workOrdersApi } from "../../src/api/work-orders";
import { STATUS_LABEL } from "../../src/labels";
import { getSelectedTeam } from "../../src/session";
import { colors } from "../../src/theme";

export default function WorkOrdersScreen() {
  const router = useRouter();
  const [items, setItems] = useState<WorkOrder[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const team = await getSelectedTeam();
      if (!team?.id) throw new Error("未选择团队");
      const res = await workOrdersApi.list({ team_id: team.id });
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.wrap}>
      {busy && !items.length ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 88 }}
          refreshing={busy}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={styles.empty}>{error || "暂无工单，点右下角新建"}</Text>
          }
          ListHeaderComponent={
            error && items.length ? (
              <Text style={styles.error}>{error}</Text>
            ) : null
          }
          renderItem={({ item }) => {
            const st = STATUS_LABEL[item.status] || {
              color: colors.muted,
              text: item.status,
            };
            return (
              <Pressable
                style={styles.card}
                onPress={() => router.push(`/work-order/${item.id}`)}
              >
                <View style={styles.row}>
                  <Text style={styles.title} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <View
                    style={[styles.badge, { backgroundColor: `${st.color}22` }]}
                  >
                    <Text style={[styles.badgeText, { color: st.color }]}>
                      {st.text}
                    </Text>
                  </View>
                </View>
                <Text style={styles.meta} numberOfLines={1}>
                  {item.id}
                </Text>
              </Pressable>
            );
          }}
        />
      )}
      <Pressable
        style={styles.fab}
        onPress={() => router.push("/work-order/new")}
      >
        <Text style={styles.fabText}>＋ 新建</Text>
      </Pressable>
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
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  title: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  meta: { marginTop: 8, color: colors.muted, fontSize: 12 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  error: { color: colors.danger, marginBottom: 8 },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 24,
    backgroundColor: colors.primary,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
