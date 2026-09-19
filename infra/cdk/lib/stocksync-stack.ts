import { Stack, StackProps } from "aws-cdk-lib";
import { HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Construct } from "constructs";
import { Auth } from "./constructs/Auth";
import { DataLayer } from "./constructs/DataLayer";
import { SyncEngine } from "./constructs/SyncEngine";
import { RealtimeApi } from "./constructs/RealtimeApi";
import { Observability } from "./constructs/Observability";
import { PlatformCrud } from "./constructs/PlatformCrud";

export class StocksyncStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const auth = new Auth(this, "Auth");

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
      authorizer: auth.authorizer,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
    });

    // /staff (owner-only, Auth.ts's staffInviteFn) lives on the same
    // HttpApi RealtimeApi owns — cross-construct wiring, same pattern as
    // checkout's write_dedup/SQS grants below, since the authorizer and
    // the HttpApi are owned by two different constructs.
    realtimeApi.httpApi.addRoutes({
      path: "/staff",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("StaffInviteIntegration", auth.staffInviteFn),
      authorizer: auth.authorizer,
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

    const platformCrud = new PlatformCrud(this, "PlatformCrud", {
      httpApi: realtimeApi.httpApi,
      authorizer: auth.authorizer,
    });

    // checkout.ts calls writeIntake.ts's handler directly, in-process (no
    // new AWS surface for the actual stock-affecting write) — so it needs
    // the exact same write_dedup/SQS grants and env vars write-intake
    // itself has. write_dedup and the write queue are owned by
    // SyncEngine, so this wiring can only happen here, once both
    // constructs exist — same pattern as the resolver's WebSocket grant
    // above.
    dataLayer.writeDedupTable.grantReadWriteData(platformCrud.checkoutFn);
    syncEngine.writeQueue.grantSendMessages(platformCrud.checkoutFn);
    platformCrud.checkoutFn.addEnvironment("WRITE_DEDUP_TABLE_NAME", dataLayer.writeDedupTable.tableName);
    platformCrud.checkoutFn.addEnvironment("WRITE_QUEUE_URL", syncEngine.writeQueue.queueUrl);
  }
}
