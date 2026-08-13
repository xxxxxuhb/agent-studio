# Agent Studio 文档

| 文档 | 内容 |
|------|------|
| [环境配置指南.md](./环境配置指南.md) | `.env`、**Docker MySQL**、JWT / Bridge / Git bot / SSH |
| [对接外部Git.md](./对接外部Git.md) | 对接公司 GitLab / GitHub（本仓库不内置 GitLab） |
| [架构与时序图.md](./架构与时序图.md) | 系统架构、工单时序、鉴权、数据落盘（Mermaid） |
| [问题记录.md](./问题记录.md) | 联调踩坑与根因（按时间倒序） |
| [../README.md](../README.md) | 仓库简介与日常启动命令 |
| [../deploy/](../deploy/) | Docker Compose：**仅 MySQL** |
| [../apps/studio-api/sql/](../apps/studio-api/sql/) | `init.sql` 一键建库建表 |

Agent 自动遵循的搭建流程：项目 Skill [`skills/local-stack-setup/`](../skills/local-stack-setup/)（含 [mysql.md](../skills/local-stack-setup/mysql.md)）。
