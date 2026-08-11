import { useEffect, useMemo, useState } from "react";
import { Button, Layout, Menu, Space, Typography, theme } from "antd";
import {
  ApartmentOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  FolderOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
  SwapOutlined,
  TeamOutlined,
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

const { Header, Sider, Content } = Layout;

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

  const menuItems = useMemo(() => {
    const items = [
      { key: "/work-orders", icon: <FileTextOutlined />, label: "工单" },
      { key: "/projects", icon: <FolderOutlined />, label: "项目" },
      { key: "/bridges", icon: <CloudServerOutlined />, label: "执行器" },
      { key: "/logs", icon: <ProfileOutlined />, label: "日志" },
      { key: "/digital-humans", icon: <RobotOutlined />, label: "数字人" },
      { key: "/pipelines", icon: <ApartmentOutlined />, label: "流水线" },
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

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth={64} theme="light" width={220}>
        <div className="brand">
          <Typography.Title level={4} style={{ margin: 0 }}>
            Agent Studio
          </Typography.Title>
          <Typography.Text type="secondary">
            {team?.name || "数字人管理台"}
          </Typography.Text>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: colorBgContainer,
            padding: "0 24px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Typography.Text strong>
            {menuItems.find((m) => m.key === selected)?.label}
          </Typography.Text>
          <Space>
            <Typography.Text type="secondary">
              {team?.name}
              {team?.my_role ? ` · ${team.my_role}` : ""}
            </Typography.Text>
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
            <Typography.Text type="secondary">
              {user?.display_name || user?.username || "…"}
              {user?.is_admin ? " · 管理员" : ""}
            </Typography.Text>
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
        <Content style={{ margin: 24 }}>
          <div
            style={{
              padding: 24,
              minHeight: 360,
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
