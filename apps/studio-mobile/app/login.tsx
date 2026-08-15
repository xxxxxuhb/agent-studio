import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { authApi } from "../src/api/auth";
import { defaultApiBase, getApiBase, setApiBase } from "../src/config";
import { resetHttpClient } from "../src/http";
import { setSession } from "../src/session";
import { colors } from "../src/theme";

export default function LoginScreen() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiBase, setApiBaseDraft] = useState(defaultApiBase());
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getApiBase().then(setApiBaseDraft);
  }, []);

  async function onLogin() {
    setError("");
    setBusy(true);
    try {
      await setApiBase(apiBase);
      resetHttpClient();
      const res = await authApi.login({
        username: username.trim(),
        password,
      });
      await setSession(res.token, {
        id: res.user.id,
        username: res.user.username,
        display_name: res.user.display_name,
        is_admin: res.user.is_admin,
      });
      router.replace("/select-team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "登录失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Text style={styles.brand}>Agent Studio</Text>
        <Text style={styles.sub}>移动控制面 · 只连 Studio API</Text>

        <Text style={styles.label}>用户名</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          placeholderTextColor={colors.muted}
        />

        <Text style={styles.label}>密码</Text>
        <TextInput
          secureTextEntry
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="password"
          placeholderTextColor={colors.muted}
        />

        <Pressable onPress={() => setShowAdvanced((v) => !v)}>
          <Text style={styles.link}>
            {showAdvanced ? "隐藏" : "显示"} API 地址
          </Text>
        </Pressable>
        {showAdvanced ? (
          <>
            <Text style={styles.hint}>
              真机请填电脑局域网地址，如 http://192.168.1.10:8790/api
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              value={apiBase}
              onChangeText={setApiBaseDraft}
              placeholder={defaultApiBase()}
              placeholderTextColor={colors.muted}
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.btn, busy && styles.btnDisabled]}
          disabled={busy || !username.trim() || !password}
          onPress={onLogin}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={styles.btnText}>登录</Text>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  wrap: { flex: 1, padding: 24, justifyContent: "center" },
  brand: {
    fontSize: 32,
    fontWeight: "700",
    color: colors.text,
    letterSpacing: -0.5,
  },
  sub: { marginTop: 6, marginBottom: 28, color: colors.muted, fontSize: 14 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 14,
  },
  link: { color: colors.primary, marginBottom: 10, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, marginBottom: 8 },
  error: { color: colors.danger, marginBottom: 12 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.primaryText, fontSize: 16, fontWeight: "600" },
});
