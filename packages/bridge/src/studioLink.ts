import { io, type Socket } from "socket.io-client";
import {
  describeActiveDriver,
  listAgentDriverIds,
} from "@agent-studio/agent-runtime";

export type StudioLinkOptions = {
  studioUrl: string;
  token: string;
  name: string;
  publicUrl: string;
};

export type StudioLink = {
  bridgeId: string;
  setBusy: (runId: string | null) => void;
  close: () => void;
};

/**
 * Connect executor → Studio over Socket.IO (/bridges).
 * Syncs online / offline / busy without HTTP polling.
 */
export function connectStudioLink(opts: StudioLinkOptions): Promise<StudioLink> {
  const base = opts.studioUrl.replace(/\/$/, "").replace(/\/api$/, "");
  const driver = describeActiveDriver();

  return new Promise((resolve, reject) => {
    const socket: Socket = io(`${base}/bridges`, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 2000,
    });

    let bridgeId = "";
    let currentRunId = "";
    let settled = false;

    const payload = () => ({
      token: opts.token,
      name: opts.name,
      base_url: opts.publicUrl,
      driver: driver.id,
      driver_label: driver.label,
      dry_run: driver.dryRun,
      model: driver.model || "",
      platform: process.platform,
      available_drivers: listAgentDriverIds(),
      id: bridgeId || undefined,
      status: currentRunId ? ("busy" as const) : ("online" as const),
      current_run_id: currentRunId || "",
    });

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(err);
    };

    socket.on("connect", () => {
      socket.emit("bridge_register", payload(), (res: { ok?: boolean; bridge?: { id: string }; error?: string }) => {
        if (!res?.ok || !res.bridge?.id) {
          fail(new Error(res?.error || "bridge_register failed"));
          return;
        }
        bridgeId = res.bridge.id;
        console.log(`WS linked to Studio as ${bridgeId} (driver=${driver.id})`);
        // Re-assert busy immediately after reconnect so Studio does not think we are idle.
        if (currentRunId) {
          socket.emit("bridge_status", {
            status: "busy",
            current_run_id: currentRunId,
            driver: describeActiveDriver().id,
            driver_label: describeActiveDriver().label,
            dry_run: describeActiveDriver().dryRun,
            base_url: opts.publicUrl,
          });
        }
        if (!settled) {
          settled = true;
          resolve({
            bridgeId,
            setBusy: (runId) => {
              currentRunId = runId || "";
              socket.emit("bridge_status", {
                status: runId ? "busy" : "online",
                current_run_id: runId || "",
                driver: describeActiveDriver().id,
                driver_label: describeActiveDriver().label,
                dry_run: describeActiveDriver().dryRun,
                base_url: opts.publicUrl,
              });
            },
            close: () => {
              socket.emit("bridge_status", {
                status: "offline",
                current_run_id: "",
              });
              socket.close();
            },
          });
        }
      });
    });

    socket.on("disconnect", (reason) => {
      console.warn(`Studio WS disconnected: ${reason}`);
    });

    socket.on("connect_error", (err) => {
      if (!settled) fail(err instanceof Error ? err : new Error(String(err)));
      else console.warn(`Studio WS connect_error: ${err.message}`);
    });

    // keep-alive ping while connected
    const ping = setInterval(() => {
      if (!socket.connected || !bridgeId) return;
      socket.emit("bridge_ping");
      if (currentRunId) {
        socket.emit("bridge_status", {
          status: "busy",
          current_run_id: currentRunId,
        });
      }
    }, 15_000);
    ping.unref?.();

    socket.on("disconnect", () => {
      /* interval kept; reconnect handled by socket.io */
    });
  });
}
