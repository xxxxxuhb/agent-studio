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
import { SafeAreaView } from "react-native-safe-area-context";
import type { TeamListItem } from "@agent-studio/agent-schema";
import { teamsApi } from "../src/api/auth";
import { clearSession, setSelectedTeam } from "../src/session";
import { colors } from "../src/theme";

export default function SelectTeamScreen() {
  const router = useRouter();
  const [items, setItems] = useState<TeamListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await teamsApi.list();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载团队失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pick(team: TeamListItem) {
    await setSelectedTeam({
      id: team.id,
      slug: team.slug,
      name: team.name,
      my_role: team.my_role,
    });
    router.replace("/(tabs)/work-orders");
  }

  async function logout() {
    await clearSession();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>选择团队</Text>
        <Pressable onPress={logout}>
          <Text style={styles.link}>退出</Text>
        </Pressable>
      </View>
      {busy ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={
            <Text style={styles.empty}>{error || "暂无团队"}</Text>
          }
          ListHeaderComponent={
            error && items.length ? (
              <Text style={styles.error}>{error}</Text>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable style={styles.card} onPress={() => pick(item)}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.meta}>
                {item.slug}
                {item.my_role ? ` · ${item.my_role}` : ""}
              </Text>
            </Pressable>
          )}
          refreshing={busy}
          onRefresh={load}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: { fontSize: 22, fontWeight: "700", color: colors.text },
  link: { color: colors.primary, fontSize: 15 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  meta: { marginTop: 4, color: colors.muted, fontSize: 13 },
  empty: { textAlign: "center", color: colors.muted, marginTop: 40 },
  error: { color: colors.danger, marginBottom: 8 },
});
