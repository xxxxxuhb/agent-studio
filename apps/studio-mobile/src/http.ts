import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { getApiBase } from "./config";
import { clearSession, getToken } from "./session";

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

let client: AxiosInstance | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

async function getClient(): Promise<AxiosInstance> {
  const baseURL = await getApiBase();
  if (!client || client.defaults.baseURL !== baseURL) {
    client = axios.create({
      baseURL,
      timeout: 30_000,
      headers: { "Content-Type": "application/json" },
    });
    client.interceptors.request.use(async (config) => {
      const token = await getToken();
      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
    client.interceptors.response.use(
      (res: AxiosResponse) => res,
      async (err) => {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          const url = String(err.config?.url || "");
          if (!url.includes("/auth/login") && !url.includes("/auth/register")) {
            await clearSession();
            onUnauthorized?.();
          }
        }
        return Promise.reject(new Error(extractErrorMessage(err)));
      },
    );
  }
  return client;
}

/** Force HTTP client to pick up a new API base URL. */
export function resetHttpClient() {
  client = null;
}

export async function get<T>(url: string, config?: AxiosRequestConfig) {
  const http = await getClient();
  const { data } = await http.get<T>(url, config);
  return data;
}

export async function post<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  const http = await getClient();
  const { data } = await http.post<T>(url, body, config);
  return data;
}

export async function put<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  const http = await getClient();
  const { data } = await http.put<T>(url, body, config);
  return data;
}

export async function patch<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
) {
  const http = await getClient();
  const { data } = await http.patch<T>(url, body, config);
  return data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig) {
  const http = await getClient();
  const { data } = await http.delete<T>(url, config);
  return data;
}
