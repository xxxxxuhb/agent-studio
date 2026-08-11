import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { clearSession, getToken } from "../auth/session";

export type HttpErrorPayload = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

function extractErrorMessage(err: unknown): string {
  if (!axios.isAxiosError(err)) {
    return err instanceof Error ? err.message : "请求失败";
  }
  const data = err.response?.data as HttpErrorPayload | undefined;
  const msg = data?.message || data?.error || err.message || "请求失败";
  return Array.isArray(msg) ? msg.join("; ") : String(msg);
}

export const http: AxiosInstance = axios.create({
  baseURL: "/api",
  timeout: 30_000,
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (res: AxiosResponse) => res,
  (err) => {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      const url = String(err.config?.url || "");
      if (!url.includes("/auth/login") && !url.includes("/auth/register")) {
        clearSession();
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/login")
        ) {
          window.location.assign("/login");
        }
      }
    }
    return Promise.reject(new Error(extractErrorMessage(err)));
  },
);

export async function get<T>(url: string, config?: AxiosRequestConfig) {
  const { data } = await http.get<T>(url, config);
  return data;
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  const { data } = await http.post<T>(url, body, config);
  return data;
}

export async function put<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  const { data } = await http.put<T>(url, body, config);
  return data;
}

export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  const { data } = await http.patch<T>(url, body, config);
  return data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig) {
  const { data } = await http.delete<T>(url, config);
  return data;
}
