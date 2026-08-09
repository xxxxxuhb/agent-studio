import { loadDotEnv, startBridgeFromEnv } from "@agent-studio/bridge";

loadDotEnv();
await startBridgeFromEnv();
