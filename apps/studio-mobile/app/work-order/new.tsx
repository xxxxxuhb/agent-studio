import { projectNeedsPreferredBridge } from "@agent-studio/agent-schema";
import type {
  BridgeExecutor,
  PipelinePublic,
  Project,
  WorkOrder,
  WorkOrderCategory,
  WorkOrderCreate,
} from "@agent-studio/agent-schema";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bridgesApi } from "../../src/api/bridges";
import { pipelinesApi } from "../../src/api/pipelines";
import { projectsApi } from "../../src/api/projects";
import { genWorkOrderId, workOrdersApi } from "../../src/api/work-orders";
import { ChipGroup } from "../../src/components/ChipGroup";
import { SelectField, SelectSheet } from "../../src/components/SelectField";
import { CATEGORY_OPTIONS, PRIORITY_OPTIONS } from "../../src/labels";
import { getSelectedTeam } from "../../src/session";
import { colors } from "../../src/theme";

type SheetKind = "project" | "pipeline" | "bridge" | null;

export default function CreateWorkOrderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [category, setCategory] = useState("requirement");
  const [priority, setPriority] = useState("medium");
  const [projectId, setProjectId] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [bridgeId, setBridgeId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [pipelines, setPipelines] = useState<PipelinePublic[]>([]);
  const [bridges, setBridges] = useState<BridgeExecutor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startAfter, setStartAfter] = useState(true);
  const [error, setError] = useState("");
  const [sheet, setSheet] = useState<SheetKind>(null);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  );
  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === pipelineId),
    [pipelines, pipelineId],
  );
  const selectedBridge = useMemo(
    () => bridges.find((b) => b.id === bridgeId),
    [bridges, bridgeId],
  );
  const needsBridge = Boolean(
    selectedProject && projectNeedsPreferredBridge(selectedProject),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const team = await getSelectedTeam();
      if (!team?.id) throw new Error("未选择团队");
      const [pRes, pipeRes, bRes] = await Promise.all([
        projectsApi.list({ team_id: team.id }),
        pipelinesApi.list({ team_id: team.id, enabled: "true" }),
        bridgesApi.list({ team_id: team.id }),
      ]);
      const enabledProjects = pRes.items.filter((p) => p.enabled !== false);
      setProjects(enabledProjects);
      setPipelines(pipeRes.items);
      setBridges(bRes.items);
      if (enabledProjects[0]?.id) {
        const first = enabledProjects[0];
        setProjectId(first.id);
        if (first.preferred_bridge_id) setBridgeId(first.preferred_bridge_id);
      }
      if (pipeRes.items[0]?.id) setPipelineId(pipeRes.items[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedProject) return;
    if (selectedProject.preferred_bridge_id) {
      setBridgeId(selectedProject.preferred_bridge_id);
    } else if (projectNeedsPreferredBridge(selectedProject)) {
      setBridgeId("");
    }
  }, [selectedProject]);

  async function onSubmit() {
    if (!title.trim() || !requirement.trim()) {
      Alert.alert("请填写", "标题和需求不能为空");
      return;
    }
    if (!pipelineId && startAfter) {
      Alert.alert("请选择", "启动前必须选择流水线");
      return;
    }
    if (needsBridge && !bridgeId.trim()) {
      Alert.alert("请选择", "本地仓库项目必须指定执行器");
      return;
    }
    setSaving(true);
    try {
      const team = await getSelectedTeam();
      if (!team?.id) throw new Error("未选择团队");
      const payload: WorkOrderCreate = {
        id: genWorkOrderId(),
        team_id: team.id,
        title: title.trim(),
        requirement: requirement.trim(),
        category: category as WorkOrderCategory,
        priority: priority as WorkOrder["priority"],
        tags: [],
        clarifications: [],
        status: "draft",
        pipeline_id: pipelineId || undefined,
        project_id: projectId || "",
        preferred_bridge_id: bridgeId || "",
      };
      const created = await workOrdersApi.create(payload);
      if (startAfter && pipelineId) {
        await workOrdersApi.start(created.id, {
          pipeline_id: pipelineId,
          executor: "studio",
          preferred_bridge_id: bridgeId || undefined,
        });
      }
      router.replace(`/work-order/${created.id}`);
    } catch (e) {
      Alert.alert("创建失败", e instanceof Error ? e.message : "未知错误");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView
        style={styles.wrap}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.section}>基本信息</Text>
        <View style={styles.card}>
          <Text style={styles.fieldLabel}>
            标题 <Text style={styles.req}>*</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="一句话说明要做什么"
            placeholderTextColor={colors.muted}
            returnKeyType="next"
          />
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
            需求描述 <Text style={styles.req}>*</Text>
          </Text>
          <TextInput
            style={[styles.input, styles.area]}
            multiline
            value={requirement}
            onChangeText={setRequirement}
            placeholder="背景、目标、范围、验收标准…"
            placeholderTextColor={colors.muted}
            textAlignVertical="top"
          />
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>类型</Text>
          <ChipGroup
            options={CATEGORY_OPTIONS}
            value={category}
            onChange={setCategory}
          />
          <Text style={[styles.fieldLabel, { marginTop: 14 }]}>优先级</Text>
          <ChipGroup
            options={PRIORITY_OPTIONS}
            value={priority}
            onChange={setPriority}
          />
        </View>

        <Text style={styles.section}>运行配置</Text>
        <View style={styles.card}>
          <SelectField
            label="项目"
            valueLabel={selectedProject?.name}
            placeholder="不绑定项目"
            onPress={() => setSheet("project")}
          />
          <View style={styles.divider} />
          <SelectField
            label="流水线"
            required={startAfter}
            valueLabel={selectedPipeline?.name}
            placeholder="请选择流水线"
            onPress={() => setSheet("pipeline")}
          />
          <View style={styles.divider} />
          <SelectField
            label="执行器"
            required={needsBridge}
            valueLabel={
              selectedBridge
                ? `${selectedBridge.name || selectedBridge.id}`
                : bridgeId
                  ? bridgeId
                  : undefined
            }
            placeholder={
              needsBridge ? "必须指定执行器" : "自动分配空闲执行器"
            }
            onPress={() => setSheet("bridge")}
            error={
              needsBridge && !bridgeId
                ? "本地仓库项目须指定执行器所在机器"
                : undefined
            }
          />
          {selectedBridge ? (
            <Text style={styles.meta}>
              {[selectedBridge.status, selectedBridge.driver]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
        </View>

        <View style={styles.switchCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>创建后立即开始</Text>
            <Text style={styles.switchHint}>
              关闭则只保存草稿，稍后在详情页启动
            </Text>
          </View>
          <Switch
            value={startAfter}
            onValueChange={setStartAfter}
            trackColor={{ false: colors.border, true: `${colors.primary}88` }}
            thumbColor={startAfter ? colors.primary : "#f4f4f5"}
          />
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <Pressable
          style={[styles.submit, saving && styles.disabled]}
          disabled={saving}
          onPress={onSubmit}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitText}>
              {startAfter ? "创建并启动" : "保存草稿"}
            </Text>
          )}
        </Pressable>
      </View>

      <SelectSheet
        visible={sheet === "project"}
        title="选择项目"
        options={projects.map((p) => ({
          value: p.id,
          label: p.name,
          hint: p.id,
        }))}
        value={projectId}
        allowEmpty
        emptyLabel="不绑定项目"
        onChange={setProjectId}
        onClose={() => setSheet(null)}
      />
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  section: {
    marginTop: 8,
    marginBottom: 2,
    marginLeft: 4,
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 8,
  },
  fieldLabel: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  req: { color: colors.danger },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
  },
  area: { minHeight: 140, paddingTop: 12 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: 4,
  },
  meta: { color: colors.muted, fontSize: 12, marginTop: -2, marginLeft: 2 },
  switchCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  switchTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  switchHint: { color: colors.muted, fontSize: 12, marginTop: 2 },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  submit: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  disabled: { opacity: 0.6 },
  error: { color: colors.danger, marginBottom: 4 },
});
