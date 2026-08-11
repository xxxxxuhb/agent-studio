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

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): StoredUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function getSelectedTeam(): StoredTeam | null {
  try {
    const raw = localStorage.getItem(TEAM_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredTeam;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setSelectedTeam(team: StoredTeam | null) {
  if (!team) {
    localStorage.removeItem(TEAM_KEY);
    return;
  }
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(TEAM_KEY);
}

export function isLoggedIn() {
  return Boolean(getToken());
}

export function hasSelectedTeam() {
  return Boolean(getSelectedTeam()?.id);
}
