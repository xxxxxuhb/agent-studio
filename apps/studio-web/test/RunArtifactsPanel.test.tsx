import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import type { ComponentProps } from "react";
import { RunArtifactsPanel } from "../src/components/RunArtifactsPanel";
import { runLogsApi } from "../src/api/run-logs";

vi.mock("../src/api/run-logs", () => ({
  runLogsApi: {
    listArtifacts: vi.fn(),
    readArtifact: vi.fn(),
  },
}));

function renderPanel(
  props: Partial<ComponentProps<typeof RunArtifactsPanel>> = {},
) {
  return render(
    <ConfigProvider>
      <RunArtifactsPanel
        runId="run_1"
        bridgeRunId="br_1"
        snapshotPaths={[]}
        {...props}
      />
    </ConfigProvider>,
  );
}

describe("RunArtifactsPanel", () => {
  beforeEach(() => {
    vi.mocked(runLogsApi.listArtifacts).mockReset();
    vi.mocked(runLogsApi.readArtifact).mockReset();
  });

  it("lists bridge and stored items with source tags", async () => {
    vi.mocked(runLogsApi.listArtifacts).mockResolvedValue({
      studio_run_id: "run_1",
      bridge_run_id: "br_1",
      bridge_base_url: "http://bridge",
      root: "/tmp",
      stored_count: 1,
      items: [
        {
          name: "dev-summary.md",
          bytes: 12,
          updated_at: "2026-08-14T10:00:00.000Z",
          source: "bridge",
        },
        {
          name: "plan.md",
          bytes: 8,
          updated_at: "2026-08-14T09:00:00.000Z",
          source: "stored",
        },
      ],
    });

    renderPanel();

    expect(await screen.findByText("dev-summary.md")).toBeInTheDocument();
    expect(screen.getByText("plan.md")).toBeInTheDocument();
    expect(screen.getByText("已入库 1")).toBeInTheDocument();
    expect(screen.getByText("入库")).toBeInTheDocument();
    expect(screen.getAllByText("Bridge").length).toBeGreaterThan(0);
  });

  it("opens stored content when Bridge file is gone", async () => {
    const user = userEvent.setup();
    vi.mocked(runLogsApi.listArtifacts).mockResolvedValue({
      studio_run_id: "run_1",
      bridge_run_id: "br_1",
      bridge_base_url: "",
      root: "",
      stored_count: 1,
      hint: "Bridge 不可用；以下为已入库产物。",
      items: [
        {
          name: "ops.md",
          bytes: 4,
          updated_at: "2026-08-14T10:00:00.000Z",
          source: "stored",
        },
      ],
    });
    vi.mocked(runLogsApi.readArtifact).mockResolvedValue({
      name: "ops.md",
      bytes: 4,
      updated_at: "2026-08-14T10:00:00.000Z",
      content_type: "text/plain",
      content: "shipped",
      source: "stored",
    });

    renderPanel();

    expect(
      await screen.findByText((text) => text.includes("Bridge 不可用")),
    ).toBeInTheDocument();

    await user.click(screen.getByText("ops.md"));

    await waitFor(() => {
      expect(runLogsApi.readArtifact).toHaveBeenCalledWith("run_1", "ops.md");
    });
    expect(await screen.findByText("来自入库")).toBeInTheDocument();
    expect(screen.getByText("shipped")).toBeInTheDocument();
  });

  it("can open snapshot basename via 打开 when listed", async () => {
    const user = userEvent.setup();
    vi.mocked(runLogsApi.listArtifacts).mockResolvedValue({
      studio_run_id: "run_1",
      bridge_run_id: "br_1",
      bridge_base_url: "http://bridge",
      root: "",
      items: [
        {
          name: "requirement.md",
          bytes: 3,
          updated_at: "2026-08-14T10:00:00.000Z",
          source: "bridge",
        },
      ],
      stored_count: 0,
    });
    vi.mocked(runLogsApi.readArtifact).mockResolvedValue({
      name: "requirement.md",
      bytes: 3,
      updated_at: "2026-08-14T10:00:00.000Z",
      content_type: "text/plain",
      content: "req",
      source: "stored",
    });

    renderPanel({
      snapshotPaths: ["docs/runs/br_1/requirement.md"],
    });

    const openBtn = await screen.findByRole("button", { name: "打开" });
    await user.click(openBtn);

    await waitFor(() => {
      expect(runLogsApi.readArtifact).toHaveBeenCalledWith(
        "run_1",
        "requirement.md",
      );
    });
    expect(await screen.findByText("req")).toBeInTheDocument();
  });

  it("marks missing snapshot paths as 未落盘", async () => {
    vi.mocked(runLogsApi.listArtifacts).mockResolvedValue({
      studio_run_id: "run_1",
      bridge_run_id: "br_1",
      bridge_base_url: "http://bridge",
      root: "",
      items: [],
      stored_count: 0,
    });

    renderPanel({
      snapshotPaths: ["docs/runs/br_1/requirement.md"],
    });

    expect(await screen.findByText("未落盘")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开" })).toBeNull();
  });
});