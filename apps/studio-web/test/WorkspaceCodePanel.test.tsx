import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigProvider } from "antd";
import {
  monacoLanguageFromPath,
  WorkspaceCodePanel,
} from "../src/components/WorkspaceCodePanel";
import { workspaceApi } from "../src/api/workspace";

vi.mock("../src/api/workspace", () => ({
  workspaceApi: {
    describe: vi.fn(),
    tree: vi.fn(),
    file: vi.fn(),
    prepare: vi.fn(),
  },
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, language }: { value?: string; language?: string }) => (
    <pre data-testid="monaco" data-language={language}>
      {value}
    </pre>
  ),
}));

function renderPanel(
  props: Partial<Parameters<typeof WorkspaceCodePanel>[0]> = {},
) {
  return render(
    <ConfigProvider>
      <WorkspaceCodePanel kind="work-order" id="wo-1" {...props} />
    </ConfigProvider>,
  );
}

describe("monacoLanguageFromPath", () => {
  it("maps common extensions", () => {
    expect(monacoLanguageFromPath("src/app.ts")).toBe("typescript");
    expect(monacoLanguageFromPath("README.md")).toBe("markdown");
    expect(monacoLanguageFromPath("a.bin")).toBe("plaintext");
  });
});

describe("WorkspaceCodePanel", () => {
  beforeEach(() => {
    vi.mocked(workspaceApi.describe).mockReset();
    vi.mocked(workspaceApi.tree).mockReset();
    vi.mocked(workspaceApi.file).mockReset();
    vi.mocked(workspaceApi.prepare).mockReset();
  });

  it("lists tree entries and opens a file in the editor", async () => {
    const user = userEvent.setup();
    vi.mocked(workspaceApi.describe).mockResolvedValue({
      kind: "work-order",
      id: "wo-1",
      project_id: "proj-a",
      bridge: {
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        online: true,
      },
      repos: [{ repo_id: "backend", name: "API", role: "backend" }],
      default_repo_id: "backend",
    });
    vi.mocked(workspaceApi.tree).mockResolvedValue({
      project_id: "proj-a",
      repo_id: "backend",
      path: "",
      entries: [
        { name: "src", type: "dir" },
        { name: "README.md", type: "file", bytes: 12 },
      ],
    });
    vi.mocked(workspaceApi.file).mockResolvedValue({
      project_id: "proj-a",
      repo_id: "backend",
      path: "README.md",
      name: "README.md",
      bytes: 12,
      updated_at: "2026-08-30T00:00:00.000Z",
      content_type: "text/markdown",
      content: "# hello cloud",
    });

    renderPanel({ defaultRepoId: "backend" });

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();

    await user.click(screen.getByText("README.md"));

    await waitFor(() => {
      expect(workspaceApi.file).toHaveBeenCalledWith(
        "work-order",
        "wo-1",
        expect.objectContaining({
          repoId: "backend",
          path: "README.md",
        }),
      );
    });
    expect(await screen.findByTestId("monaco")).toHaveTextContent(
      "# hello cloud",
    );
    expect(screen.getByTestId("monaco")).toHaveAttribute(
      "data-language",
      "markdown",
    );
  });

  it("shows prepare button when the workspace is missing on Bridge", async () => {
    vi.mocked(workspaceApi.describe).mockResolvedValue({
      kind: "project",
      id: "proj-a",
      project_id: "proj-a",
      bridge: {
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        online: true,
      },
      repos: [{ repo_id: "backend", name: "backend", role: "backend" }],
      default_repo_id: "backend",
    });
    vi.mocked(workspaceApi.tree).mockRejectedValue(
      new Error("工作区尚未在该执行器上准备。可点击「在执行器上准备」。"),
    );

    renderPanel({ kind: "project", id: "proj-a" });

    expect(
      await screen.findByText("工作区尚未在该执行器上准备"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "在执行器上准备" }),
    ).toBeInTheDocument();
  });

  it("prepare button calls workspaceApi.prepare", async () => {
    const user = userEvent.setup();
    vi.mocked(workspaceApi.describe).mockResolvedValue({
      kind: "project",
      id: "proj-a",
      project_id: "proj-a",
      bridge: {
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        online: true,
      },
      repos: [{ repo_id: "backend", name: "backend", role: "backend" }],
      default_repo_id: "backend",
    });
    vi.mocked(workspaceApi.tree)
      .mockRejectedValueOnce(
        new Error("工作区尚未在该执行器上准备。可点击「在执行器上准备」。"),
      )
      .mockResolvedValue({
        project_id: "proj-a",
        repo_id: "backend",
        path: "",
        entries: [{ name: "README.md", type: "file", bytes: 1 }],
      });
    vi.mocked(workspaceApi.prepare).mockResolvedValue({
      project_id: "proj-a",
      bridge: {
        id: "br-1",
        name: "cloud",
        status: "online",
        driver: "cursor",
        online: true,
      },
      repos: [{ repo_id: "backend", clone_status: "ready", clone_error: "" }],
    });

    renderPanel({ kind: "project", id: "proj-a" });
    const btn = await screen.findByRole("button", { name: "在执行器上准备" });
    await user.click(btn);
    await waitFor(() => {
      expect(workspaceApi.prepare).toHaveBeenCalledWith(
        "project",
        "proj-a",
        "br-1",
      );
    });
  });
});
