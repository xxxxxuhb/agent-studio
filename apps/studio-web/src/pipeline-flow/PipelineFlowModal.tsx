import { useMemo, useState } from "react";
import { Modal, Space, Tag, Typography } from "antd";
import type { WorkOrderRunEvent, WorkOrderRunStep } from "@agent-studio/agent-schema";
import { PipelineFlowView } from "./PipelineFlowView";
import {
  eventsForStep,
  PipelineStepDetailModal,
} from "./PipelineStepDetailModal";
import { toFlowStepsFromRun, type FlowStepInput } from "./buildPipelineFlow";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  steps: FlowStepInput[];
  withStatus?: boolean;
  /** When provided (work-order run), node click opens step detail. */
  runSteps?: WorkOrderRunStep[];
  events?: WorkOrderRunEvent[];
  onOpenDoc?: (path: string) => void;
};

export function PipelineFlowModal({
  open,
  onClose,
  title = "流程可视化",
  steps,
  withStatus,
  runSteps,
  events,
  onOpenDoc,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedStep = useMemo(() => {
    if (!selectedId || !runSteps?.length) return null;
    return runSteps.find((s) => s.step_id === selectedId) || null;
  }, [selectedId, runSteps]);

  const relatedEvents = useMemo(
    () => (selectedStep ? eventsForStep(events, selectedStep) : []),
    [events, selectedStep],
  );

  const flowSteps = useMemo(() => {
    if (runSteps?.length) return toFlowStepsFromRun(runSteps);
    return steps;
  }, [runSteps, steps]);

  return (
    <>
      <Modal
        title={title}
        open={open}
        onCancel={onClose}
        footer={null}
        width="92vw"
        style={{ top: 24 }}
        destroyOnHidden
        className="pipeline-flow-modal"
        styles={{ body: { paddingTop: 8 } }}
        afterClose={() => setSelectedId(null)}
      >
        {withStatus ? (
          <Space wrap size={8} style={{ marginBottom: 10 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              图例：
            </Typography.Text>
            <Tag color="default">待执行</Tag>
            <Tag color="processing">执行中 / 待确认</Tag>
            <Tag color="success">已执行</Tag>
            <Tag color="error">失败 / 驳回</Tag>
            <Tag color="warning">需人工确认</Tag>
            {runSteps?.length ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                · 点击节点查看该步产出与详情
              </Typography.Text>
            ) : null}
          </Space>
        ) : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 10 }}>
          左侧物料拖到画布加点；步骤标注类型；虚线红边为驳回跳转。
        </Typography.Paragraph>
        )}
        <PipelineFlowView
          steps={flowSteps}
          withStatus={withStatus}
          height="min(72vh, 620px)"
          showMiniMap
          onNodeClick={
            runSteps?.length
              ? (stepId) => setSelectedId(stepId)
              : undefined
          }
        />
      </Modal>

      <PipelineStepDetailModal
        open={Boolean(selectedStep)}
        onClose={() => setSelectedId(null)}
        step={selectedStep}
        events={relatedEvents}
        onOpenDoc={onOpenDoc}
      />
    </>
  );
}
