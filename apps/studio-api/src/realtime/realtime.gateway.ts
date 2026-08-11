import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { BridgesService } from "../bridges/bridges.service";
import { WorkOrdersService } from "../work-orders/work-orders.service";
import { RealtimeHub } from "./realtime.hub";

@WebSocketGateway({
  cors: {
    origin: [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      process.env.STUDIO_WEB_ORIGIN || "",
    ].filter(Boolean),
  },
})
@Injectable()
export class RealtimeGateway
  implements OnModuleInit, OnModuleDestroy, OnGatewayConnection
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly watchRef = new Map<string, number>();
  private unsubWo?: () => void;
  private unsubBridge?: () => void;
  private unsubBridges?: () => void;
  private pollTimer?: ReturnType<typeof setInterval>;
  private polling = false;

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly hub: RealtimeHub,
    private readonly workOrders: WorkOrdersService,
    private readonly bridges: BridgesService,
  ) {}

  onModuleInit() {
    this.unsubWo = this.hub.onWorkOrder((order) => {
      this.server?.to(this.room(order.id)).emit("work_order", order);
    });
    this.unsubBridge = this.hub.onBridge((bridge) => {
      this.server?.to("bridges:watch").emit("bridge", bridge);
    });
    this.unsubBridges = this.hub.onBridges((items) => {
      this.server?.to("bridges:watch").emit("bridges", { items });
    });
    this.pollTimer = setInterval(() => void this.pollWatched(), 5_000);
  }

  onModuleDestroy() {
    this.unsubWo?.();
    this.unsubBridge?.();
    this.unsubBridges?.();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  handleConnection(client: Socket) {
    client.emit("hello", { ok: true, service: "studio-api" });
  }

  @SubscribeMessage("subscribe_bridges")
  subscribeBridges(@ConnectedSocket() client: Socket) {
    client.join("bridges:watch");
    const items = this.bridges.list();
    client.emit("bridges", { items });
    return { ok: true, total: items.length };
  }

  @SubscribeMessage("unsubscribe_bridges")
  unsubscribeBridges(@ConnectedSocket() client: Socket) {
    client.leave("bridges:watch");
    return { ok: true };
  }

  @SubscribeMessage("subscribe_work_order")
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { work_order_id?: string },
  ) {
    const id = body?.work_order_id?.trim();
    if (!id) return { ok: false, error: "work_order_id required" };
    client.join(this.room(id));
    this.watchRef.set(id, (this.watchRef.get(id) || 0) + 1);
    try {
      const order = await this.workOrders.get(id);
      client.emit("work_order", order);
      return { ok: true, id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  @SubscribeMessage("unsubscribe_work_order")
  unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { work_order_id?: string },
  ) {
    const id = body?.work_order_id?.trim();
    if (!id) return { ok: false };
    client.leave(this.room(id));
    const n = (this.watchRef.get(id) || 1) - 1;
    if (n <= 0) this.watchRef.delete(id);
    else this.watchRef.set(id, n);
    return { ok: true, id };
  }

  private room(id: string) {
    return `wo:${id}`;
  }

  private async pollWatched() {
    if (this.polling || !this.watchRef.size) return;
    this.polling = true;
    try {
      for (const id of [...this.watchRef.keys()]) {
        let order;
        try {
          order = await this.workOrders.get(id);
        } catch {
          this.watchRef.delete(id);
          continue;
        }
        if (
          order.run?.executor === "dify" &&
          (order.status === "running" || order.status === "pending_approval") &&
          order.run.dify?.workflow_run_id
        ) {
          try {
            const updated = await this.workOrders.syncDify(id);
            this.server.to(this.room(id)).emit("work_order", updated);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`poll sync failed ${id}: ${msg}`);
            try {
              const soft = await this.workOrders.noteDifySyncRetry(id, msg);
              this.server.to(this.room(id)).emit("work_order", soft);
            } catch {
              /* ignore persist errors */
            }
          }
        }
      }
    } finally {
      this.polling = false;
    }
  }
}
