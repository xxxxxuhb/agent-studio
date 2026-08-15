import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const API_BASE_KEY = "studio_mobile_api_base";

/** Sensible defaults for simulators; physical devices need LAN IP in Settings. */
export function defaultApiBase(): string {
  if (Platform.OS === "android") {
    return "http://10.0.2.2:8790/api";
  }
  return "http://127.0.0.1:8790/api";
}

export async function getApiBase(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(API_BASE_KEY);
    if (stored?.trim()) return stored.trim().replace(/\/$/, "");
  } catch {
    /* ignore */
  }
  return defaultApiBase();
}

export async function setApiBase(url: string): Promise<void> {
  const next = url.trim().replace(/\/$/, "");
  await AsyncStorage.setItem(API_BASE_KEY, next);
}

/** Socket.IO origin = API host without `/api` suffix. */
export function socketOriginFromApiBase(apiBase: string): string {
  return apiBase.replace(/\/api\/?$/, "") || apiBase;
}
