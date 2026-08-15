import { useEffect, useState } from "react";
import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from "antd";
import { getSelectedTeam } from "../auth/session";
import {
  auditApi,
  usageApi,
  type AuditLog,
  type UsageEvent,
  type UsageSummary,
} from "../api/usage-audit";

export function UsageAuditPage() {
  const teamId = getSelectedTeam()?.id || "";
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [usageItems, setUsageItems] = useState<UsageEvent[]>([]);
  const [auditItems, setAuditItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  async function reload() {
    if (!teamId) return;
    setLoading(true);
    try {
      const [s, u, a] = await Promise.all([
        usageApi.summary({ team_id: teamId }),
        usageApi.list({ team_id: teamId, limit: 50 }),
        auditApi.list({ team_id: teamId, limit: 50 }),
      ]);
      setSummary(s);
      setUsageItems(u.items || []);
      setAuditItems(a.items || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);

  if (!teamId) {
    return <Alert type="info" showIcon message="请先选择团队" />;
  }

  const driverRows = Object.entries(summary?.by_driver || {}).map(
    ([driver, v]) => ({
      key: driver,
      driver,
      ...v,
    }),
  );

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        用量与审计
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        阶段完成时记 usage（token 待驱动上报）；审批 / 流水线 / 密钥变更写入审计。
      </Typography.Paragraph>

      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Card loading={loading} size="small">
            <Statistic title="Usage 事件" value={summary?.events || 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading} size="small">
            <Statistic title="Token 合计" value={summary?.total_tokens || 0} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card loading={loading} size="small">
            <Statistic
              title="成本 (USD)"
              value={summary?.cost_usd || 0}
              precision={4}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        items={[
          {
            key: "usage",
            label: "用量",
            children: (
              <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                <Table
                  size="small"
                  loading={loading}
                  pagination={false}
                  rowKey="driver"
                  dataSource={driverRows}
                  locale={{ emptyText: <Empty description="暂无按驱动汇总" /> }}
                  columns={[
                    { title: "驱动", dataIndex: "driver" },
                    { title: "事件数", dataIndex: "events", width: 90 },
                    { title: "Tokens", dataIndex: "total_tokens", width: 110 },
                    {
                      title: "Cost",
                      dataIndex: "cost_usd",
                      width: 110,
                      render: (v: number) => Number(v || 0).toFixed(4),
                    },
                  ]}
                />
                <Table
                  size="small"
                  loading={loading}
                  rowKey="id"
                  dataSource={usageItems}
                  pagination={{ pageSize: 20 }}
                  locale={{ emptyText: <Empty description="暂无用量事件" /> }}
                  columns={[
                    {
                      title: "时间",
                      dataIndex: "at",
                      width: 180,
                      render: (v: string) =>
                        v ? new Date(v).toLocaleString() : "",
                    },
                    { title: "驱动", dataIndex: "driver", width: 100 },
                    { title: "阶段", dataIndex: "stage", width: 100 },
                    {
                      title: "工单",
                      dataIndex: "work_order_id",
                      ellipsis: true,
                    },
                    {
                      title: "Tokens",
                      dataIndex: "total_tokens",
                      width: 90,
                      render: (v: number | null) => v ?? "—",
                    },
                    {
                      title: "Dry-run",
                      dataIndex: "dry_run",
                      width: 80,
                      render: (v: number) =>
                        v ? <Tag>dry</Tag> : <Tag color="blue">live</Tag>,
                    },
                  ]}
                />
              </Space>
            ),
          },
          {
            key: "audit",
            label: "审计",
            children: (
              <Table
                size="small"
                loading={loading}
                rowKey="id"
                dataSource={auditItems}
                pagination={{ pageSize: 20 }}
                locale={{ emptyText: <Empty description="暂无审计记录" /> }}
                columns={[
                  {
                    title: "时间",
                    dataIndex: "at",
                    width: 180,
                    render: (v: string) =>
                      v ? new Date(v).toLocaleString() : "",
                  },
                  { title: "操作者", dataIndex: "actor_name", width: 120 },
                  {
                    title: "动作",
                    dataIndex: "action",
                    width: 160,
                    render: (v: string) => <Tag>{v}</Tag>,
                  },
                  { title: "摘要", dataIndex: "summary", ellipsis: true },
                  {
                    title: "资源",
                    dataIndex: "resource_id",
                    width: 140,
                    ellipsis: true,
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
