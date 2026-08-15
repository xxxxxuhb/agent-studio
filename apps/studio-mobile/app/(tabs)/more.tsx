import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  defaultApiBase,
  getApiBase,
  setApiBase,
} from "../../src/config";
import { resetHttpClient } from "../../src/http";
import {
  clearSession,
  getSelectedTeam,
  getStoredUser,
  setSelectedTeam,
  type StoredTeam,
  type StoredUser,
} from "../../src/session";
import { colors } from "../../src/theme";

export default function MoreScreen() {
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [team, setTeam] = useState<StoredTeam | null>(null);
  const [apiBase, setApiBaseDraft] = useState(defaultApiBase());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      setUser(await getStoredUser());
      setTeam(await getSelectedTeam());
      setApiBaseDraft(await getApiBase());
    })();
  }, []);

  async function saveApi() {
    await setApiBase(apiBase);
    resetHttpClient();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function switchTeam() {
    await setSelectedTeam(null);
    router.replace("/select-team");
  }

  async function logout() {
    await clearSession();
    router.replace("/login");
  }

  return (
    <SafeAreaView edges={["bottom"]} style={styles.safe}>
      <View style={styles.section}>
        <Text style={styles.label}>当前用户</Text>
        <Text style={styles.value}>
          {user?.display_name || user?.username || "—"}
        </Text>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>当前团队</Text>
        <Text style={styles.value}>{team?.name || "—"}</Text>
        <Pressable onPress={switchTeam}>
          <Text style={styles.link}>切换团队</Text>
        </Pressable>
      </View>
      <View style={styles.section}>
        <Text style={styles.label}>Studio API</Text>
        <Text style={styles.hint}>
          控制面只调 API（+ Socket）。真机需公网/VPN/局域网 HTTPS 或 HTTP。
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={apiBase}
          onChangeText={setApiBaseDraft}
        />
        <Pressable style={styles.btn} onPress={saveApi}>
          <Text style={styles.btnText}>{saved ? "已保存" : "保存地址"}</Text>
        </Pressable>
      </View>
      <Pressable
        style={[styles.btn, styles.danger]}
        onPress={() =>
          Alert.alert("退出登录", "确认退出？", [
            { text: "取消", style: "cancel" },
            { text: "退出", style: "destructive", onPress: logout },
          ])
        }
      >
        <Text style={styles.btnText}>退出登录</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: 16, gap: 16 },
  section: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  label: { color: colors.muted, fontSize: 12 },
  value: { color: colors.text, fontSize: 16, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    marginTop: 4,
  },
  link: { color: colors.primary, marginTop: 4, fontSize: 14 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  danger: { backgroundColor: colors.danger },
  btnText: { color: colors.primaryText, fontWeight: "600" },
});
