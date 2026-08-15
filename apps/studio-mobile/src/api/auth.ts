import { get, post } from "../http";
import type {
  AuthLoginResponse,
  AuthUserPublic,
  TeamListItem,
} from "@agent-studio/agent-schema";

export const authApi = {
  login(body: { username: string; password: string }) {
    return post<AuthLoginResponse>("/auth/login", body);
  },
  me() {
    return get<AuthUserPublic>("/auth/me");
  },
};

export const teamsApi = {
  list() {
    return get<{ items: TeamListItem[]; total: number }>("/teams");
  },
};
