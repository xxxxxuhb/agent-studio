import { io, type Socket } from "socket.io-client";
import type { SystemNotification } from "@agent-studio/agent-schema";

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

export type NotificationLiveHandlers = {
  onNotification?: (n: SystemNotification) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
};

/** Subscribe to team-scoped in-app notifications for the current user. */
export function subscribeNotifications(
  teamId: string,
  userId: string,
  handlers: NotificationLiveHandlers,
) {
  const socket = getSocket();
  const payload = { team_id: teamId, user_id: userId };

  const onConnect = () => {
    handlers.onStatus?.("connected");
    socket.emit("subscribe_notifications", payload);
  };
  const onDisconnect = () => handlers.onStatus?.("disconnected");
  const onNotification = (n: SystemNotification) => {
    if (n?.team_id === teamId && n?.user_id === userId) {
      handlers.onNotification?.(n);
    }
  };

  handlers.onStatus?.(socket.connected ? "connected" : "connecting");
  socket.on("connect", onConnect);
  socket.on("disconnect", onDisconnect);
  socket.on("notification", onNotification);

  if (socket.connected) {
    socket.emit("subscribe_notifications", payload);
  } else {
    socket.connect();
  }

  return () => {
    socket.emit("unsubscribe_notifications", payload);
    socket.off("connect", onConnect);
    socket.off("disconnect", onDisconnect);
    socket.off("notification", onNotification);
  };
}
