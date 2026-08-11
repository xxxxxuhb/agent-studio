import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { BridgesService } from "./bridges.service";

type BridgeSocketData = {
  bridgeId?: string;
};

/**
 * Executor WebSocket namespace: /bridges
 * Bridge CLI connects here to sync online / offline / busy.
 */
@WebSocketGateway({
  namespace: "/bridges",
  cors: {
    origin: true,
  },
})
export class BridgesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(BridgesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly bridges: BridgesService) {}

  handleConnection(client: Socket) {
    client.emit("hello", { ok: true, channel: "bridges" });
  }

  handleDisconnect(client: Socket) {
    const id = (client.data as BridgeSocketData).bridgeId;
    if (!id) return;
    void this.bridges.markOffline(id).then(() => {
      this.logger.log(`bridge disconnected → offline: ${id}`);
    });
  }

  @SubscribeMessage("bridge_register")
  async register(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      token?: string;
      name?: string;
      base_url?: string;
      driver?: string;
      driver_label?: string;
      dry_run?: boolean;
      model?: string;
      platform?: string;
      available_drivers?: string[];
      id?: string;
    },
  ) {
    try {
      const bridge = await this.bridges.connectFromWs({
        token: body?.token || "",
        name: body?.name || "unnamed",
        base_url: body?.base_url || "",
        driver: body?.driver,
        driver_label: body?.driver_label,
        dry_run: body?.dry_run,
        model: body?.model,
        platform: body?.platform,
        available_drivers: body?.available_drivers,
        id: body?.id,
      });
      (client.data as BridgeSocketData).bridgeId = bridge.id;
      client.join(`bridge:${bridge.id}`);
      this.logger.log(
        `bridge registered via WS: ${bridge.id} (${bridge.driver})`,
      );
      return { ok: true, bridge };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  @SubscribeMessage("bridge_status")
  async status(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      status?: "online" | "offline" | "busy";
      current_run_id?: string;
      driver?: string;
      driver_label?: string;
      dry_run?: boolean;
      model?: string;
      base_url?: string;
    },
  ) {
    const id = (client.data as BridgeSocketData).bridgeId;
    if (!id) return { ok: false, error: "not registered" };
    try {
      const bridge = await this.bridges.setStatus(id, {
        status: body?.status || "online",
        current_run_id: body?.current_run_id,
        driver: body?.driver,
        driver_label: body?.driver_label,
        dry_run: body?.dry_run,
        model: body?.model,
        base_url: body?.base_url,
      });
      return { ok: true, bridge };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @SubscribeMessage("bridge_ping")
  async ping(@ConnectedSocket() client: Socket) {
    const id = (client.data as BridgeSocketData).bridgeId;
    if (!id) return { ok: false };
    try {
      const current = await this.bridges.get(id);
      const bridge = await this.bridges.setStatus(id, {
        status: current.status === "busy" ? "busy" : "online",
        current_run_id: current.current_run_id,
      });
      return { ok: true, at: bridge.last_seen_at };
    } catch {
      return { ok: false };
    }
  }
}
