import { io, type Socket } from "socket.io-client";
import type { WorkOrder } from "@agent-studio/agent-schema";

let shared: Socket | null = null;

function getSocket() {
  if (!shared) {
    shared = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
  }
  return shared;
}

export type WorkOrderLiveHandlers = {
  onWorkOrder?: (order: WorkOrder) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
};

/** Subscribe to live work-order updates (Socket.IO). Returns unsubscribe. */
export function subscribeWorkOrder(
  workOrderId: string,
  handlers: WorkOrderLiveHandlers,
) {
  const socket = getSocket();
  const onConnect = () => {
    handlers.onStatus?.("connected");
    socket.emit("subscribe_work_order", { work_order_id: workOrderId });
  };
  const onDisconnect = () => handlers.onStatus?.("disconnected");
  const onWorkOrder = (order: WorkOrder) => {
    if (order?.id === workOrderId) handlers.onWorkOrder?.(order);
  };

  handlers.onStatus?.(socket.connected ? "connected" : "connecting");
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("work_order", onWorkOrder);

  if (socket.connected) {
    socket.emit("subscribe_work_order", { work_order_id: workOrderId });
  } else {
    socket.connect();
  }

  return () => {
    socket.emit("unsubscribe_work_order", { work_order_id: workOrderId });
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("work_order", onWorkOrder);
  };
}
