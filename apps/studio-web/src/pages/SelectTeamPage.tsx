import { useEffect, useState } from "react";
import {
  Button,
  Col,
  Empty,
  Layout,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  theme,
  message,
} from "antd";
import {
  ArrowRightOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { TeamListItem } from "@agent-studio/agent-schema";
import { teamsApi } from "../api/auth";
import {
  clearSession,
  getStoredUser,
  setSelectedTeam,
} from "../auth/session";

const { Header, Content } = Layout;

export function SelectTeamPage() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [items, setItems] = useState<TeamListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await teamsApi.list();
        setItems(res.items);
      } catch (err) {
        message.error(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function enterTeam(team: TeamListItem) {
    setSelectedTeam({
      id: team.id,
      slug: team.slug,
      name: team.name,
      my_role: team.my_role,
    });
    message.success(`已进入团队「${team.name}」`);
    navigate("/work-orders", { replace: true });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
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
        <Space size={12} align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            Agent Studio
          </Typography.Title>
          <Typography.Text type="secondary">选择团队</Typography.Text>
        </Space>
        <Space>
          {user?.is_admin ? (
            <Button
              size="small"
              icon={<SettingOutlined />}
              onClick={() => navigate("/teams")}
            >
              团队管理
            </Button>
          ) : null}
          <Typography.Text type="secondary">
            <UserOutlined style={{ marginRight: 6 }} />
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
          <Space
            direction="vertical"
            size="large"
            style={{ width: "100%" }}
          >
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                选择团队
              </Typography.Title>
              <Typography.Text type="secondary">
                选择你有权限的团队进入工作台
                {user?.is_admin
                  ? "；系统管理员可从右上角配置团队与成员"
                  : ""}
              </Typography.Text>
            </div>

            {loading ? (
              <div style={{ textAlign: "center", padding: "64px 0" }}>
                <Spin size="large" />
              </div>
            ) : items.length === 0 ? (
              <Empty
                style={{ padding: "48px 0" }}
                description={
                  user?.is_admin
                    ? "你还没有可进入的团队。请先创建团队，或将自己加入已有团队。"
                    : "你还没有可访问的团队，请联系管理员开通权限。"
                }
              >
                {user?.is_admin ? (
                  <Button type="primary" onClick={() => navigate("/teams")}>
                    去配置团队
                  </Button>
                ) : null}
              </Empty>
            ) : (
              <Row gutter={[16, 16]}>
                {items.map((team) => (
                  <Col key={team.id} xs={24} sm={12} lg={8} xl={6}>
                    <button
                      type="button"
                      className="team-pick-card"
                      onClick={() => enterTeam(team)}
                    >
                      <div className="team-pick-card__icon">
                        <TeamOutlined />
                      </div>
                      <div className="team-pick-card__body">
                        <Typography.Text strong className="team-pick-card__title">
                          {team.name}
                        </Typography.Text>
                        <Typography.Text
                          type="secondary"
                          className="team-pick-card__slug"
                        >
                          {team.slug}
                        </Typography.Text>
                        <Space size={8} wrap className="team-pick-card__meta">
                          {team.my_role ? (
                            <Tag color="blue">{team.my_role}</Tag>
                          ) : null}
                          <Typography.Text type="secondary">
                            {team.member_count} 人
                          </Typography.Text>
                        </Space>
                      </div>
                      <span className="team-pick-card__action">
                        进入
                        <ArrowRightOutlined />
                      </span>
                    </button>
                  </Col>
                ))}
              </Row>
            )}
          </Space>
        </div>
      </Content>
    </Layout>
  );
}
