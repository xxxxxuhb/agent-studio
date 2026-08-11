# Agent Studio 文档

| 文档 | 内容 |
|------|------|
| [环境配置指南.md](./环境配置指南.md) | `.env`、**Docker MySQL**、JWT / Bridge / Git bot / SSH |
| [本地Dify与GitLab搭建指南.md](./本地Dify与GitLab搭建指南.md) | 本机起 GitLab、Dify，并接到 Agent Studio |
| [架构与时序图.md](./架构与时序图.md) | 系统架构、工单时序、鉴权、数据落盘（Mermaid） |
| [../README.md](../README.md) | 仓库简介与日常启动命令 |
| [../deploy/](../deploy/) | Docker Compose：MySQL / GitLab / Dify |
| [../apps/studio-api/sql/](../apps/studio-api/sql/) | `init.sql` 一键建库建表 |

Agent 自动遵循的搭建流程：项目 Skill [`skills/local-stack-setup/`](../skills/local-stack-setup/)（含 [mysql.md](../skills/local-stack-setup/mysql.md)，不绑定某台机器的目录布局）。
