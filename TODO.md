# Agent Studio — backlog

## Cloud Dify Agent as step executor

- [ ] Support binding a **cloud Dify Agent** as a per-digital-human step executor (not only pipeline-level Workflow).
- [ ] Extend digital-human `dify` binding with Agent App Key / `api_base`; invoke Dify Agent API when the step runs.
- [ ] Define **repo clone / sandbox** strategy for cloud Agent (today clones live on Bridge host under `~/AgentStudio/{project.id}/{repo.id}`; cloud Agent path is not implemented).

Notes (2026-08-10): UI fields `dify.agent_id` / `agent_name` are metadata only today. Work orders always run via Dify Workflow → HTTP Bridge.

## Bridge MR / commit-record parsing

- [x] Make `parseCommitRecord` accept markdown **table** format (`| field | value |`), not only `- field: value` lists.  
  Fixed 2026-08-10. Backfilled backend MR: http://localhost:8929/root/dify-pipeline-backend/-/merge_requests/1 (run `64c74bb8`).

## Git bot identity + SSH remotes

- [x] Bridge: `BRIDGE_GIT_AUTHOR_*` + `BRIDGE_GIT_SSH_KEY` → force commit author; rewrite origin to SSH; MR still via bot `GITLAB_TOKEN`.
- [x] Studio `ensureCloned` prefers SSH when key / `STUDIO_GIT_PREFER_SSH` is set.
- [x] Ops: dedicated GitLab user `agent-studio-bot` + bot PAT in Bridge `.env`; SSH key moved off root; Maintainer on demo projects.

## Hardening (2026-08-10)

- [x] Bridge HTTP auth (`BRIDGE_HTTP_TOKEN` / `STUDIO_BRIDGE_TOKEN`) on mutating routes; `/health` public.
- [x] Minimal CI (typecheck + bridge tests).
- [x] Split Dify secrets to `data/dify-secrets.yaml` (0600); prefer `DIFY_*` env.

## UX polish (2026-08-10)

- [x] Digital-human Dify Agent fields labeled as metadata / not executed.
- [x] Work-order Human Input auto-syncs `form_token` (less manual「同步 Dify」).
- [x] README links to `docs/` + `skills/local-stack-setup`.
- [x] Extract work-order routing + dify utils from god service (further splits TBD).
