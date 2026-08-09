/** Agent driver auth UX for “添加执行器”. Keys stay in the browser / command; not sent to Studio. */

export type AgentAuthMode = "key" | "login" | "none";

export type AgentDriverAuthMeta = {
  id: string;
  label: string;
  /** Modes the UI should offer */
  authModes: AgentAuthMode[];
  defaultAuthMode: AgentAuthMode;
  /** Env var name when using key mode */
  envKey?: string;
  /** Extra env when auth_mode=login (e.g. QODER_AUTH=qodercli) */
  loginEnv?: Record<string, string>;
  /** How to obtain a key */
  keyGuide?: {
    title: string;
    url: string;
    steps: string[];
  };
  /** Tip when login is chosen */
  loginTip?: string;
  /** Shown when driver is not ready for production use */
  unsupportedTip?: string;
};

export const AGENT_DRIVER_AUTH: Record<string, AgentDriverAuthMeta> = {
  cursor: {
    id: "cursor",
    label: "Cursor Agent SDK",
    authModes: ["key", "login"],
    defaultAuthMode: "key",
    envKey: "CURSOR_API_KEY",
    keyGuide: {
      title: "获取 Cursor API Key",
      url: "https://cursor.com/dashboard/api",
      steps: [
        "打开 Cursor Dashboard → API Keys",
        "创建 User API Key（或团队 Service Account Key）",
        "复制后粘贴到下方（仅写入你复制的启动命令，不会存到 Studio 服务器）",
      ],
    },
    loginTip:
      "启动命令会带 --login：执行器第一次运行时打开浏览器完成 Cursor SDK 登录，凭证保存在本机 ~/.cursor/sdk/auth.json（不是 Cursor IDE 登录态）。",
  },
  trae: {
    id: "trae",
    label: "TraeCode CLI (traecli)",
    authModes: ["key", "login"],
    defaultAuthMode: "key",
    envKey: "TRAECLI_PERSONAL_ACCESS_TOKEN",
    keyGuide: {
      title: "获取 Trae CLI 登录令牌",
      url: "https://docs.trae.cn/cli_login-token",
      steps: [
        "执行器需已安装 TraeCode CLI（命令 traecli）",
        "在 Trae 平台生成 CLI 登录令牌（以 trae-lt- 开头）",
        "粘贴到下方；企业专属域名可另外设置 TRAECLI_HOST",
      ],
    },
    loginTip:
      "先在执行器机器安装 traecli，运行 traecli 后执行 /login 完成浏览器登录；之后用生成的启动命令即可（无需再填 token）。",
  },
  qoder: {
    id: "qoder",
    label: "Qoder Agent SDK",
    authModes: ["key", "login"],
    defaultAuthMode: "key",
    envKey: "QODER_PERSONAL_ACCESS_TOKEN",
    loginEnv: { QODER_AUTH: "qodercli" },
    keyGuide: {
      title: "获取 Qoder Personal Access Token",
      url: "https://qoder.com/account/integrations",
      steps: [
        "打开 Qoder Account → Integrations",
        "创建 Personal Access Token（PAT）",
        "复制后粘贴到下方（写入启动命令的 QODER_PERSONAL_ACCESS_TOKEN）",
      ],
    },
    loginTip:
      "命令会带 QODER_AUTH=qodercli：请先在执行器安装并登录 qodercli，SDK 将复用本机登录态（适合个人电脑，不适合无头 CI）。",
  },
  auto: {
    id: "auto",
    label: "auto（按本机可用：cursor → trae → qoder）",
    authModes: ["key", "login", "none"],
    defaultAuthMode: "none",
    envKey: "CURSOR_API_KEY",
    keyGuide: {
      title: "可选：预先配置 Cursor API Key",
      url: "https://cursor.com/dashboard/api",
      steps: [
        "auto 会选用本机第一个可用的真实 Agent（cursor / trae / qoder）",
        "若要用 Cursor：可在此填 Key，或启动后依赖 --login / 已有 SDK 登录",
      ],
    },
    loginTip:
      "带 --login 时，若走到 Cursor 会打开浏览器做 SDK 登录；仍须本机具备至少一种可用 Agent。",
  },
  openai: {
    id: "openai",
    label: "openai",
    authModes: ["none"],
    defaultAuthMode: "none",
    unsupportedTip:
      "openai driver 尚未实现。请改用 cursor / trae / qoder。",
  },
};

export const DRIVER_SELECT_OPTIONS = Object.values(AGENT_DRIVER_AUTH).map(
  (d) => ({
    value: d.id,
    label: `${d.id} — ${d.label}`,
  }),
);

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9._/:@%+=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function prefixEnvs(command: string, envs: Record<string, string>): string {
  const parts = Object.entries(envs)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}=${shellQuote(v)}`);
  if (!parts.length) return command;
  return `${parts.join(" ")} ${command}`;
}

/** Apply key / login env prefixes onto install commands (client-side only). */
export function decorateBridgeCommand(
  command: string,
  opts: {
    authMode: AgentAuthMode;
    meta?: AgentDriverAuthMeta;
    apiKey?: string;
  },
): string {
  const { authMode, meta, apiKey } = opts;
  if (!meta) return command;
  if (authMode === "key" && meta.envKey && apiKey?.trim()) {
    return prefixEnvs(command, { [meta.envKey]: apiKey.trim() });
  }
  if (authMode === "login" && meta.loginEnv) {
    return prefixEnvs(command, meta.loginEnv);
  }
  return command;
}
