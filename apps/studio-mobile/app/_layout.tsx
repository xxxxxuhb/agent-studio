import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { setUnauthorizedHandler } from "../src/http";
import {
  getSelectedTeam,
  getToken,
} from "../src/session";
import { colors } from "../src/theme";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [hasTeam, setHasTeam] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthed(false);
      setHasTeam(false);
      router.replace("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      const team = await getSelectedTeam();
      if (cancelled) return;
      setAuthed(Boolean(token));
      setHasTeam(Boolean(team?.id));
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [segments]);

  useEffect(() => {
    if (!ready) return;
    const inAuth = segments[0] === "login";
    const inTeam = segments[0] === "select-team";
    if (!authed && !inAuth) {
      router.replace("/login");
      return;
    }
    if (authed && !hasTeam && !inTeam && !inAuth) {
      router.replace("/select-team");
      return;
    }
    if (authed && hasTeam && (inAuth || inTeam)) {
      router.replace("/(tabs)/work-orders");
    }
  }, [ready, authed, hasTeam, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="select-team" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="work-order/new"
          options={{ headerShown: true, title: "新建工单" }}
        />
        <Stack.Screen
          name="work-order/[id]"
          options={{ headerShown: true, title: "工单详情" }}
        />
        <Stack.Screen
          name="run-log/[id]"
          options={{ headerShown: true, title: "运行日志" }}
        />
        <Stack.Screen
          name="artifact"
          options={{ headerShown: true, title: "产物" }}
        />
      </Stack>
    </>
  );
}
