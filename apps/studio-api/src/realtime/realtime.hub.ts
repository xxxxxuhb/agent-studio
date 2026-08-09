import { Injectable } from "@nestjs/common";
import type { BridgeExecutor, WorkOrder } from "@agent-studio/agent-schema";

type WorkOrderListener = (order: WorkOrder) => void;
type BridgeListener = (bridge: BridgeExecutor) => void;
type BridgesListener = (bridges: BridgeExecutor[]) => void;

@Injectable()
export class RealtimeHub {
  private readonly workOrderListeners = new Set<WorkOrderListener>();
  private readonly bridgeListeners = new Set<BridgeListener>();
  private readonly bridgesListeners = new Set<BridgesListener>();

  onWorkOrder(listener: WorkOrderListener) {
    this.workOrderListeners.add(listener);
    return () => this.workOrderListeners.delete(listener);
  }

  publishWorkOrder(order: WorkOrder) {
    for (const listener of this.workOrderListeners) {
      try {
        listener(order);
      } catch {
        /* ignore */
      }
    }
  }

  onBridge(listener: BridgeListener) {
    this.bridgeListeners.add(listener);
    return () => this.bridgeListeners.delete(listener);
  }

  publishBridge(bridge: BridgeExecutor) {
    for (const listener of this.bridgeListeners) {
      try {
        listener(bridge);
      } catch {
        /* ignore */
      }
    }
  }

  onBridges(listener: BridgesListener) {
    this.bridgesListeners.add(listener);
    return () => this.bridgesListeners.delete(listener);
  }

  publishBridges(bridges: BridgeExecutor[]) {
    for (const listener of this.bridgesListeners) {
      try {
        listener(bridges);
      } catch {
        /* ignore */
      }
    }
  }
}
