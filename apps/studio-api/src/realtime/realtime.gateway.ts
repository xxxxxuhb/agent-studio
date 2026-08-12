import {
  Injectable,
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
  private readonly watchRef = new Map<string, number>();
  private unsubWo?: () => void;
  private unsubBridge?: () => void;
  private unsubBridges?: () => void;

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
  }

  onModuleDestroy() {
    this.unsubWo?.();
    this.unsubBridge?.();
    this.unsubBridges?.();
  }

  handleConnection(client: Socket) {
    client.emit("hello", { ok: true, service: "studio-api" });
  }

  @SubscribeMessage("subscribe_bridges")
  async subscribeBridges(@ConnectedSocket() client: Socket) {
    client.join("bridges:watch");
    const items = await this.bridges.list();
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
}
