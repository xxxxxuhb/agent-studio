import { Layout, Menu, Typography, theme } from "antd";
import {
  ApartmentOutlined,
  CloudServerOutlined,
  FileTextOutlined,
  FolderOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BridgesPage } from "./pages/BridgesPage";
import { DigitalHumansPage } from "./pages/DigitalHumansPage";
import { PipelinesPage } from "./pages/PipelinesPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RunLogsPage } from "./pages/RunLogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { WorkOrdersPage } from "./pages/WorkOrdersPage";

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: "/work-orders", icon: <FileTextOutlined />, label: "工单" },
  { key: "/projects", icon: <FolderOutlined />, label: "项目" },
  { key: "/bridges", icon: <CloudServerOutlined />, label: "执行器" },
  { key: "/logs", icon: <ProfileOutlined />, label: "日志" },
  { key: "/digital-humans", icon: <RobotOutlined />, label: "数字人" },
  { key: "/pipelines", icon: <ApartmentOutlined />, label: "流水线" },
  { key: "/settings", icon: <SettingOutlined />, label: "设置" },
];

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

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
          <Typography.Text type="secondary">数字人管理台</Typography.Text>
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
          }}
        >
          <Typography.Text strong>
            {menuItems.find((m) => m.key === selected)?.label}
          </Typography.Text>
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
