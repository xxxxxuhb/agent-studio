import { del, get, patch, post } from "../http";
import type {
  AuthLoginResponse,
  AuthUserPublic,
  TeamCreate,
  TeamDetail,
  TeamListItem,
  TeamMemberAdd,
  TeamMemberUpdate,
} from "@agent-studio/agent-schema";

export const authApi = {
  login(body: { username: string; password: string }) {
    return post<AuthLoginResponse>("/auth/login", body);
  },
  register(body: {
    username: string;
    password: string;
    display_name?: string;
  }) {
    return post<AuthLoginResponse>("/auth/register", body);
  },
  me() {
    return get<AuthUserPublic>("/auth/me");
  },
};

export const teamsApi = {
  list(params: { scope?: "all" } = {}) {
    return get<{ items: TeamListItem[]; total: number }>("/teams", {
      params: params.scope ? { scope: params.scope } : undefined,
    });
  },
  get(id: string) {
    return get<TeamDetail>(`/teams/${id}`);
  },
  create(body: TeamCreate) {
    return post<TeamDetail>("/teams", body);
  },
  addMember(id: string, body: TeamMemberAdd) {
    return post<TeamDetail>(`/teams/${id}/members`, body);
  },
  updateMember(id: string, userId: string, body: TeamMemberUpdate) {
    return patch<TeamDetail>(`/teams/${id}/members/${userId}`, body);
  },
  removeMember(id: string, userId: string) {
    return del<TeamDetail>(`/teams/${id}/members/${userId}`);
  },
  createUser(body: {
    username: string;
    password: string;
    display_name?: string;
  }) {
    return post<AuthUserPublic>("/teams/users", body);
  },
};
