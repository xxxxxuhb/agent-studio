import { useEffect, useMemo, useState } from "react";
import { Avatar, Button, Layout, Menu, Space, Typography, theme } from "antd";
import {
  AuditOutlined,
  ApartmentOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  FolderOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { BridgesPage } from "./pages/BridgesPage";
import { DigitalHumansPage } from "./pages/DigitalHumansPage";
import { LoginPage } from "./pages/LoginPage";
import { PipelinesPage } from "./pages/PipelinesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RunLogsPage } from "./pages/RunLogsPage";
import { SelectTeamPage } from "./pages/SelectTeamPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TeamsPage } from "./pages/TeamsPage";
import { UsageAuditPage } from "./pages/UsageAuditPage";
import { WorkOrdersPage } from "./pages/WorkOrdersPage";
import {
  clearSession,
  getSelectedTeam,
  getStoredUser,
  getToken,
  hasSelectedTeam,
  setSelectedTeam,
  type StoredTeam,
  type StoredUser,
} from "./auth/session";
import { authApi } from "./api/auth";
import { NotificationBell } from "./components/NotificationBell";

const { Header, Sider, Content } = Layout;

const PAGE_META: Record<
  string,
  { label: string; icon: React.ReactNode; hint: string }
> = {
  "/work-orders": {
    label: "工单",
    icon: <FileTextOutlined />,
    hint: "需求与流水线执行",
  },
  "/teams": {
    label: "团队管理",
    icon: <TeamOutlined />,
    hint: "成员与权限",
  },
  "/projects": {
    label: "项目",
    icon: <FolderOutlined />,
    hint: "仓库与工作区",
  },
  "/bridges": {
    label: "执行器",
    icon: <CloudServerOutlined />,
    hint: "Bridge 与 Agent 驱动",
  },
  "/logs": {
    label: "日志",
    icon: <ProfileOutlined />,
    hint: "运行轨迹与产物",
  },
  "/digital-humans": {
    label: "数字人",
    icon: <RobotOutlined />,
    hint: "角色与能力档案",
  },
  "/pipelines": {
    label: "流水线",
    icon: <ApartmentOutlined />,
    hint: "步骤编排",
  },
  "/usage": {
    label: "用量与审计",
    icon: <AuditOutlined />,
    hint: "Token / 成本与操作审计",
  },
  "/settings": {
    label: "设置",
    icon: <SettingOutlined />,
    hint: "个人账号与团队 Bridge / Git",
  },
};

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState<StoredUser | null>(getStoredUser());
  const [team, setTeam] = useState<StoredTeam | null>(getSelectedTeam());
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  useEffect(() => {
    void authApi
      .me()
      .then((u) => setUser(u))
      .catch(() => {
        clearSession();
        navigate("/login", { replace: true });
      });
  }, [navigate]);

  useEffect(() => {
    const onUser = (e: Event) => {
      const detail = (e as CustomEvent<StoredUser>).detail;
      if (detail?.id) setUser(detail);
    };
    window.addEventListener("studio-user-updated", onUser);
    return () => window.removeEventListener("studio-user-updated", onUser);
  }, []);

  const menuItems = useMemo(() => {
    const items = [
      { key: "/work-orders", icon: <FileTextOutlined />, label: "工单" },
      { key: "/projects", icon: <FolderOutlined />, label: "项目" },
      { key: "/bridges", icon: <CloudServerOutlined />, label: "执行器" },
      { key: "/logs", icon: <ProfileOutlined />, label: "日志" },
      { key: "/digital-humans", icon: <RobotOutlined />, label: "数字人" },
      { key: "/pipelines", icon: <ApartmentOutlined />, label: "流水线" },
      { key: "/usage", icon: <AuditOutlined />, label: "用量与审计" },
      { key: "/settings", icon: <SettingOutlined />, label: "设置" },
    ];
    if (user?.is_admin) {
      items.splice(1, 0, {
        key: "/teams",
        icon: <TeamOutlined />,
        label: "团队管理",
      });
    }
    return items;
  }, [user?.is_admin]);

  const selected =
    menuItems.find((item) => location.pathname.startsWith(item.key))?.key ||
    "/work-orders";
  const page = PAGE_META[selected] || PAGE_META["/work-orders"]!;

  return (
    <Layout className="app-shell">
      <Sider
        className="app-sider"
        breakpoint="lg"
        collapsedWidth={64}
        theme="light"
        width={208}
      >
        <div className="brand">
          <div className="brand-mark">
            <ThunderboltOutlined />
          </div>
          <div className="brand-copy">
            <Typography.Text className="brand-title">Agent Studio</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
              {team?.name || "数字人管理台"}
            </Typography.Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout className="app-main">
        <Header className="app-header" style={{ background: colorBgContainer }}>
          <div className="app-header-title">
            <span className="app-header-title-icon">{page.icon}</span>
            <div style={{ lineHeight: 1.2 }}>
              <div>{page.label}</div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {page.hint}
              </Typography.Text>
            </div>
          </div>
          <Space size="middle">
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {team?.name}
              {team?.my_role ? ` · ${team.my_role}` : ""}
            </Typography.Text>
            {team?.id && user?.id ? (
              <NotificationBell teamId={team.id} userId={user.id} />
            ) : null}
            <Button
              size="small"
              icon={<SwapOutlined />}
              onClick={() => {
                setSelectedTeam(null);
                setTeam(null);
                navigate("/select-team", { replace: true });
              }}
            >
              切换团队
            </Button>
            <div
              className="user-chip"
              role="button"
              tabIndex={0}
              title="个人设置"
              onClick={() => navigate("/settings")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") navigate("/settings");
              }}
              style={{ cursor: "pointer" }}
            >
              <Avatar size={26} icon={<UserOutlined />}>
                {(user?.display_name || user?.username || "?").slice(0, 1)}
              </Avatar>
              <Typography.Text style={{ fontSize: 13 }}>
                {user?.display_name || user?.username || "…"}
                {user?.is_admin ? " · 管理员" : ""}
              </Typography.Text>
            </div>
            <Button
              size="small"
              onClick={() => {
                clearSession();
                navigate("/login", { replace: true });
              }}
            >
              退出
            </Button>
          </Space>
        </Header>
        <Content className="app-content">
          <div
            className="app-content-inner"
            style={{
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
            }}
          >
            <Routes>
              <Route path="/" element={<Navigate to="/work-orders" replace />} />
              <Route path="/work-orders" element={<WorkOrdersPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/bridges" element={<BridgesPage />} />
              <Route path="/logs" element={<RunLogsPage />} />
              <Route path="/logs/:runId" element={<RunLogsPage />} />
              <Route path="/digital-humans" element={<DigitalHumansPage />} />
              <Route path="/pipelines" element={<PipelinesPage />} />
              <Route path="/usage" element={<UsageAuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function RequireTeam({ children }: { children: React.ReactNode }) {
  if (!hasSelectedTeam()) {
    return <Navigate to="/select-team" replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const user = getStoredUser();
  if (!user?.is_admin) {
    return <Navigate to="/select-team" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/select-team"
        element={
          <RequireAuth>
            <SelectTeamPage />
          </RequireAuth>
        }
      />
      <Route
        path="/teams"
        element={
          <RequireAuth>
            <RequireAdmin>
              <div style={{ minHeight: "100vh", padding: 24 }}>
                <TeamsPage standalone />
              </div>
            </RequireAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <RequireTeam>
              <Shell />
            </RequireTeam>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
