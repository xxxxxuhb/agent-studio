import { io, type Socket } from "socket.io-client";
import type { WorkOrder } from "@agent-studio/agent-schema";
import { getApiBase, socketOriginFromApiBase } from "../config";

let shared: Socket | null = null;
let sharedOrigin = "";

async function getSocket() {
  const apiBase = await getApiBase();
  const origin = socketOriginFromApiBase(apiBase);
  if (!shared || sharedOrigin !== origin) {
    shared?.disconnect();
    sharedOrigin = origin;
    shared = io(origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return shared;
}

export type WorkOrderLiveHandlers = {
  onWorkOrder?: (order: WorkOrder) => void;
};

/** Subscribe to live work-order updates. Returns unsubscribe. */
export function subscribeWorkOrder(
  workOrderId: string,
  handlers: WorkOrderLiveHandlers,
) {
  let cancelled = false;
  let cleanup: (() => void) | null = null;

  void (async () => {
    const socket = await getSocket();
    if (cancelled) return;

    const onConnect = () => {
      socket.emit("subscribe_work_order", { work_order_id: workOrderId });
    };
    const onWorkOrder = (order: WorkOrder) => {
      if (order?.id === workOrderId) handlers.onWorkOrder?.(order);
    };

    socket.on("connect", onConnect);
    socket.on("work_order", onWorkOrder);
    if (socket.connected) onConnect();
    else socket.connect();

    cleanup = () => {
      socket.emit("unsubscribe_work_order", { work_order_id: workOrderId });
      socket.off("connect", onConnect);
      socket.off("work_order", onWorkOrder);
    };
  })();

  return () => {
    cancelled = true;
    cleanup?.();
  };
}
