import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "studio_auth_token";
const USER_KEY = "studio_auth_user";
const TEAM_KEY = "studio_selected_team";

export type StoredUser = {
  id: string;
  username: string;
  display_name?: string;
  is_admin?: boolean;
};

export type StoredTeam = {
  id: string;
  slug: string;
  name: string;
  my_role?: string;
};

export async function getToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getStoredUser(): Promise<StoredUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export async function getSelectedTeam(): Promise<StoredTeam | null> {
  try {
    const raw = await AsyncStorage.getItem(TEAM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTeam;
  } catch {
    return null;
  }
}

export async function setSession(token: string, user: StoredUser) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}

export async function setSelectedTeam(team: StoredTeam | null) {
  if (!team) {
    await AsyncStorage.removeItem(TEAM_KEY);
    return;
  }
  await AsyncStorage.setItem(TEAM_KEY, JSON.stringify(team));
}

export async function clearSession() {
  await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, TEAM_KEY]);
}
