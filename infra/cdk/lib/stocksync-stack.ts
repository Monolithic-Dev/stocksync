import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { DataLayer } from "./constructs/DataLayer";
import { SyncEngine } from "./constructs/SyncEngine";
import { RealtimeApi } from "./constructs/RealtimeApi";
import { Observability } from "./constructs/Observability";

export class StocksyncStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const dataLayer = new DataLayer(this, "DataLayer");
    const syncEngine = new SyncEngine(this, "SyncEngine", {
      writeDedupTable: dataLayer.writeDedupTable,
      inventoryRecordsTable: dataLayer.inventoryRecordsTable,
      auditLogTable: dataLayer.auditLogTable,
      wsConnectionsTable: dataLayer.wsConnectionsTable,
    });
    const realtimeApi = new RealtimeApi(this, "RealtimeApi", {
      writeIntakeFn: syncEngine.writeIntakeFn,
      wsConnectionsTable: dataLayer.wsConnectionsTable,
      inventoryRecordsTable: dataLayer.inventoryRecordsTable,
      auditLogTable: dataLayer.auditLogTable,
    });

    // Cross-construct wiring that can only happen once both sides exist:
    // the resolver needs the WebSocket stage's management-API permission
    // and callback URL, but the stage is owned by RealtimeApi.
    realtimeApi.webSocketStage.grantManagementApiAccess(syncEngine.conflictResolverFn);
    syncEngine.conflictResolverFn.addEnvironment("WEBSOCKET_CALLBACK_URL", realtimeApi.webSocketStage.callbackUrl);

    new Observability(this, "Observability", {
      writeQueue: syncEngine.writeQueue,
      deadLetterQueue: syncEngine.deadLetterQueue,
    });
  }
}
