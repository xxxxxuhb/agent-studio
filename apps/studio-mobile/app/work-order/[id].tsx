import { projectNeedsPreferredBridge } from "@agent-studio/agent-schema";
import type {
  BridgeExecutor,
  PipelinePublic,
  Project,
  WorkOrder,
} from "@agent-studio/agent-schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { bridgesApi } from "../../src/api/bridges";
import { pipelinesApi } from "../../src/api/pipelines";
import { projectsApi } from "../../src/api/projects";
import { workOrdersApi } from "../../src/api/work-orders";
import { MarkdownBody } from "../../src/components/MarkdownBody";
import { SelectField, SelectSheet } from "../../src/components/SelectField";
import { STATUS_LABEL } from "../../src/labels";
import { getSelectedTeam } from "../../src/session";
import { colors } from "../../src/theme";
import { subscribeWorkOrder } from "../../src/ws/work-orders";

const ACTIVE = new Set(["running", "queued", "pending_approval", "waiting"]);

export default function WorkOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<WorkOrder | null>(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [showStart, setShowStart] = useState(false);
  const [pipelines, setPipelines] = useState<PipelinePublic[]>([]);
  const [bridges, setBridges] = useState<BridgeExecutor[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [pipelineId, setPipelineId] = useState("");
  const [bridgeId, setBridgeId] = useState("");
  const [sheet, setSheet] = useState<"pipeline" | "bridge" | null>(null);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const wo = await workOrdersApi.get(id);
      setOrder(wo);
      setPipelineId(wo.pipeline_id || "");
      setBridgeId(wo.preferred_bridge_id || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setBusy(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    return subscribeWorkOrder(id, {
      onWorkOrder: (wo) => setOrder(wo),
    });
  }, [id]);

  const loadStartOptions = useCallback(async (wo: WorkOrder) => {
    const team = await getSelectedTeam();
    if (!team?.id) return;
    const [pipeRes, bRes] = await Promise.all([
      pipelinesApi.list({ team_id: team.id, enabled: "true" }),
      bridgesApi.list({ team_id: team.id }),
    ]);
    setPipelines(pipeRes.items);
    setBridges(bRes.items);
    if (!pipelineId && (wo.pipeline_id || pipeRes.items[0]?.id)) {
      setPipelineId(wo.pipeline_id || pipeRes.items[0]?.id || "");
    }
    if (wo.project_id) {
      try {
        const items = (await projectsApi.list({ team_id: team.id })).items;
        const p = items.find((x) => x.id === wo.project_id) || null;
        setProject(p);
        const pref =
          wo.preferred_bridge_id || p?.preferred_bridge_id || bridgeId || "";
        setBridgeId(pref);
      } catch {
        setProject(null);
      }
    } else {
      setProject(null);
    }
  }, [bridgeId, pipelineId]);

  useEffect(() => {
    if (showStart && order) void loadStartOptions(order);
  }, [showStart, order, loadStartOptions]);

  const needsBridge = Boolean(project && projectNeedsPreferredBridge(project));
  const canDecide = order?.status === "pending_approval";
  const canResume = order?.status === "failed";
  const canCancel = order ? ACTIVE.has(order.status) : false;
  const canStart =
    order &&
    ["draft", "cancelled", "rejected"].includes(order.status) &&
    !order.run;
  const canRestart =
    order &&
    ["completed", "failed", "rejected", "cancelled", "draft"].includes(
      order.status,
    ) &&
    Boolean(order.run || order.pipeline_id);

  async function decide(decision: "approve" | "reject") {
    if (!id) return;
    setActing(true);
    try {
      const next = await workOrdersApi.decide(id, decision, feedback.trim());
      setOrder(next);
      setFeedback("");
    } catch (e) {
      Alert.alert("操作失败", e instanceof Error ? e.message : "未知错误");
    } finally {
      setActing(false);
    }
  }

  async function resume() {
    if (!id) return;
    setActing(true);
    try {
      setOrder(await workOrdersApi.resume(id, { feedback: feedback.trim() }));
    } catch (e) {
      Alert.alert("续跑失败", e instanceof Error ? e.message : "未知错误");
    } finally {
      setActing(false);
    }
  }

  async function cancel() {
    if (!id) return;
    Alert.alert("结束运行", "确认取消当前流水线？", [
      { text: "取消", style: "cancel" },
      {
        text: "结束",
        style: "destructive",
        onPress: async () => {
          setActing(true);
          try {
            setOrder(
              await workOrdersApi.cancel(id, feedback.trim() || undefined),
            );
          } catch (e) {
            Alert.alert("失败", e instanceof Error ? e.message : "未知错误");
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  }

  async function runPipeline(mode: "start" | "restart") {
    if (!id) return;
    if (!pipelineId) {
      Alert.alert("请选择流水线");
      return;
    }
    if (needsBridge && !bridgeId.trim()) {
      Alert.alert("本地仓库项目必须指定执行器");
      return;
    }
    setActing(true);
    try {
      const body = {
        pipeline_id: pipelineId,
        executor: "studio" as const,
        preferred_bridge_id: bridgeId || undefined,
        feedback: feedback.trim() || undefined,
      };
      const next =
        mode === "start"
          ? await workOrdersApi.start(id, body)
          : await workOrdersApi.restart(id, body);
      setOrder(next);
      setShowStart(false);
      setFeedback("");
    } catch (e) {
      Alert.alert(
        mode === "start" ? "启动失败" : "重新执行失败",
        e instanceof Error ? e.message : "未知错误",
      );
    } finally {
      setActing(false);
    }
  }

  const runId = useMemo(
    () =>
      order?.run?.run_id || order?.run?.studio?.bridge_run_id || "",
    [order],
  );

  if (busy && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error || "工单不存在"}</Text>
      </View>
    );
  }

  const st = STATUS_LABEL[order.status] || {
    color: colors.muted,
    text: order.status,
  };

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
    >
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.title}>{order.title}</Text>
          <View style={[styles.badge, { backgroundColor: `${st.color}22` }]}>
            <Text style={[styles.badgeText, { color: st.color }]}>{st.text}</Text>
          </View>
        </View>
        <Text style={styles.meta}>{order.id}</Text>
        {order.project_id ? (
          <Text style={styles.meta}>项目 {order.project_id}</Text>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>需求</Text>
        <MarkdownBody content={order.requirement || ""} />
      </View>

      {order.run?.steps?.length ? (
        <View style={styles.card}>
          <Text style={styles.label}>步骤</Text>
          {order.run.steps.map((step, i) => {
            const key = step.step_id || String(i);
            const open = expandedStep === key;
            const hasBody = Boolean(
              (step.output || "").trim() || (step.summary || "").trim(),
            );
            return (
              <View key={key} style={styles.stepBlock}>
                <Pressable
                  style={styles.stepHead}
                  onPress={() =>
                    setExpandedStep(open ? null : key)
                  }
                >
                  <Text style={styles.step}>
                    {i + 1}. {step.label || step.step_id} · {step.status}
                  </Text>
                  {hasBody ? (
                    <Text style={styles.stepToggle}>{open ? "收起" : "展开"}</Text>
                  ) : null}
                </Pressable>
                {open && hasBody ? (
                  <View style={styles.stepBody}>
                    {step.summary ? (
                      <>
                        <Text style={styles.label}>摘要</Text>
                        <MarkdownBody content={step.summary} />
                      </>
                    ) : null}
                    {step.output ? (
                      <>
                        <Text style={[styles.label, { marginTop: 8 }]}>
                          {step.output_title || "输出"}
                        </Text>
                        <MarkdownBody content={step.output} />
                      </>
                    ) : null}
                    {step.feedback ? (
                      <>
                        <Text style={[styles.label, { marginTop: 8 }]}>反馈</Text>
                        <MarkdownBody content={step.feedback} />
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {(canStart || canRestart) && !ACTIVE.has(order.status) ? (
        <View style={styles.card}>
          {!showStart ? (
            <Pressable
              style={[styles.btn, styles.primary]}
              onPress={() => setShowStart(true)}
            >
              <Text style={styles.btnText}>
                {canStart && !order.run ? "开始流水线" : "重新执行"}
              </Text>
            </Pressable>
          ) : (
            <>
              <SelectField
                label="流水线"
                required
                valueLabel={
                  pipelines.find((p) => p.id === pipelineId)?.name || pipelineId
                }
                placeholder="请选择流水线"
                onPress={() => setSheet("pipeline")}
              />
              <SelectField
                label="执行器"
                required={needsBridge}
                valueLabel={
                  bridges.find((b) => b.id === bridgeId)?.name ||
                  (bridgeId ? bridgeId : undefined)
                }
                placeholder={
                  needsBridge ? "必须指定执行器" : "自动分配空闲执行器"
                }
                onPress={() => setSheet("bridge")}
              />
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.mutedBtn]}
                  onPress={() => setShowStart(false)}
                >
                  <Text style={[styles.btnText, { color: colors.text }]}>
                    取消
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.primary, acting && styles.disabled]}
                  disabled={acting}
                  onPress={() =>
                    runPipeline(canStart && !order.run ? "start" : "restart")
                  }
                >
                  <Text style={styles.btnText}>
                    {acting ? "提交中…" : "确认启动"}
                  </Text>
                </Pressable>
              </View>
              <SelectSheet
                visible={sheet === "pipeline"}
                title="选择流水线"
                options={pipelines.map((p) => ({
                  value: p.id,
                  label: p.name,
                  hint: p.id,
                }))}
                value={pipelineId}
                onChange={setPipelineId}
                onClose={() => setSheet(null)}
              />
              <SelectSheet
                visible={sheet === "bridge"}
                title="选择执行器"
                options={bridges.map((b) => ({
                  value: b.id,
                  label: b.name || b.id,
                  hint: `${b.status}${b.driver ? ` · ${b.driver}` : ""}`,
                }))}
                value={bridgeId}
                allowEmpty={!needsBridge}
                emptyLabel="自动分配空闲执行器"
                onChange={setBridgeId}
                onClose={() => setSheet(null)}
              />
            </>
          )}
        </View>
      ) : null}

      {canDecide || canResume || canCancel ? (
        <View style={styles.card}>
          <Text style={styles.label}>反馈（可选）</Text>
          <TextInput
            style={styles.input}
            multiline
            value={feedback}
            onChangeText={setFeedback}
            placeholder="审批意见 / 续跑说明"
            placeholderTextColor={colors.muted}
          />
          {canDecide ? (
            <View style={styles.actions}>
              <Pressable
                style={[styles.btn, styles.approve, acting && styles.disabled]}
                disabled={acting}
                onPress={() => decide("approve")}
              >
                <Text style={styles.btnText}>通过</Text>
              </Pressable>
              <Pressable
                style={[styles.btn, styles.reject, acting && styles.disabled]}
                disabled={acting}
                onPress={() => decide("reject")}
              >
                <Text style={styles.btnText}>驳回</Text>
              </Pressable>
            </View>
          ) : null}
          {canResume ? (
            <Pressable
              style={[styles.btn, styles.approve, acting && styles.disabled]}
              disabled={acting}
              onPress={resume}
            >
              <Text style={styles.btnText}>从失败阶段续跑</Text>
            </Pressable>
          ) : null}
          {canCancel ? (
            <Pressable
              style={[styles.btn, styles.reject, acting && styles.disabled]}
              disabled={acting}
              onPress={cancel}
            >
              <Text style={styles.btnText}>结束运行</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {runId ? (
        <Pressable
          style={styles.linkCard}
          onPress={() =>
            router.push(`/run-log/${encodeURIComponent(String(runId))}`)
          }
        >
          <Text style={styles.link}>查看运行日志 / 产物（只读）</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  row: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  title: { flex: 1, fontSize: 18, fontWeight: "700", color: colors.text },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 12 },
  label: { color: colors.muted, fontSize: 12 },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  stepBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
    marginTop: 6,
  },
  stepHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  step: { flex: 1, color: colors.text, fontSize: 13 },
  stepToggle: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  stepBody: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 72,
    textAlignVertical: "top",
    color: colors.text,
  },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
  },
  primary: { backgroundColor: colors.primary },
  mutedBtn: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  approve: { backgroundColor: colors.success },
  reject: { backgroundColor: colors.danger },
  disabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "700" },
  linkCard: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  link: { color: colors.primary, fontWeight: "600" },
  error: { color: colors.danger },
});
