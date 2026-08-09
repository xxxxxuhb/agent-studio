import { io, type Socket } from "socket.io-client";
import type { BridgeExecutor } from "@agent-studio/agent-schema";

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

export type BridgesLiveHandlers = {
  onBridges?: (items: BridgeExecutor[]) => void;
  onBridge?: (bridge: BridgeExecutor) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
};

/** Live executor list (online / offline / busy) via Socket.IO. */
export function subscribeBridges(handlers: BridgesLiveHandlers) {
  const socket = getSocket();
  const onConnect = () => {
    handlers.onStatus?.("connected");
    socket.emit("subscribe_bridges");
  };
  const onDisconnect = () => handlers.onStatus?.("disconnected");
  const onBridges = (payload: { items?: BridgeExecutor[] }) => {
    handlers.onBridges?.(payload?.items || []);
  };
  const onBridge = (bridge: BridgeExecutor) => {
    handlers.onBridge?.(bridge);
  };

  handlers.onStatus?.(socket.connected ? "connected" : "connecting");
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("bridges", onBridges);
  socket.on("bridge", onBridge);

  if (socket.connected) {
    socket.emit("subscribe_bridges");
  } else {
    socket.connect();
  }

  return () => {
    socket.emit("unsubscribe_bridges");
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("bridges", onBridges);
    socket.off("bridge", onBridge);
  };
}
