import * as path from "node:path";
import { CfnOutput, Duration } from "aws-cdk-lib";
import { CorsHttpMethod, HttpApi, HttpMethod, WebSocketApi, WebSocketStage } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

export interface RealtimeApiProps {
  readonly writeIntakeFn: IFunction;
  readonly wsConnectionsTable: Table;
  readonly inventoryRecordsTable: Table;
  readonly auditLogTable: Table;
}

/**
 * REST API (POST /transactions, GET /sync, GET /audit/{item_id},
 * POST /conflicts/{item_id}/resolve — Phase 8's addition) and the
 * WebSocket API ($connect/$disconnect here; record_updated/needs_review
 * push is performed by conflictResolver.ts and conflictResolve.ts via
 * wsPush.ts, not by a route on this API — pushes go out over the
 * management API, not an inbound route).
 */
export class RealtimeApi extends Construct {
  public readonly httpApi: HttpApi;
  public readonly webSocketApi: WebSocketApi;
  public readonly webSocketStage: WebSocketStage;
  public readonly wsConnectFn: NodejsFunction;
  public readonly wsDisconnectFn: NodejsFunction;
  public readonly syncQueryFn: NodejsFunction;
  public readonly auditQueryFn: NodejsFunction;
  public readonly conflictResolveFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: RealtimeApiProps) {
    super(scope, id);

    this.httpApi = new HttpApi(this, "HttpApi", {
      // Open CORS is acceptable for a hackathon demo — flagged in
      // 07-EDGE-CASES.md E-1 as a known limitation to tighten if this
      // went beyond a hackathon (shop-scoped authorization isn't in
      // scope for the Tier-1 API-key auth model either).
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.POST, CorsHttpMethod.GET],
        allowHeaders: ["content-type", "x-api-key"],
      },
    });

    this.httpApi.addRoutes({
      path: "/transactions",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("WriteIntakeIntegration", props.writeIntakeFn),
    });

    this.syncQueryFn = new NodejsFunction(this, "SyncQueryFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/syncQuery.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { INVENTORY_RECORDS_TABLE_NAME: props.inventoryRecordsTable.tableName },
    });
    props.inventoryRecordsTable.grantReadData(this.syncQueryFn);

    this.httpApi.addRoutes({
      path: "/sync",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("SyncQueryIntegration", this.syncQueryFn),
    });

    this.auditQueryFn = new NodejsFunction(this, "AuditQueryFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/auditQuery.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName },
    });
    props.auditLogTable.grantReadData(this.auditQueryFn);

    this.httpApi.addRoutes({
      path: "/audit/{item_id}",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("AuditQueryIntegration", this.auditQueryFn),
    });

    this.wsConnectFn = new NodejsFunction(this, "WsConnectFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/wsConnect.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { WS_CONNECTIONS_TABLE_NAME: props.wsConnectionsTable.tableName },
    });

    this.wsDisconnectFn = new NodejsFunction(this, "WsDisconnectFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/wsDisconnect.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { WS_CONNECTIONS_TABLE_NAME: props.wsConnectionsTable.tableName },
    });

    // $connect writes a row, $disconnect deletes it — neither needs to
    // read the table.
    props.wsConnectionsTable.grantWriteData(this.wsConnectFn);
    props.wsConnectionsTable.grantWriteData(this.wsDisconnectFn);

    this.webSocketApi = new WebSocketApi(this, "WebSocketApi", {
      connectRouteOptions: { integration: new WebSocketLambdaIntegration("ConnectIntegration", this.wsConnectFn) },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration("DisconnectIntegration", this.wsDisconnectFn),
      },
    });

    this.webSocketStage = new WebSocketStage(this, "WebSocketStage", {
      webSocketApi: this.webSocketApi,
      stageName: "prod",
      autoDeploy: true,
    });

    this.conflictResolveFn = new NodejsFunction(this, "ConflictResolveFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/conflictResolve.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: {
        INVENTORY_RECORDS_TABLE_NAME: props.inventoryRecordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
        WS_CONNECTIONS_TABLE_NAME: props.wsConnectionsTable.tableName,
        WEBSOCKET_CALLBACK_URL: this.webSocketStage.callbackUrl,
      },
    });
    // Least-privilege: reads/writes the one record it resolves, appends
    // to the audit trail, and pushes the outcome live — created here
    // (rather than cross-wired at the stack level like the
    // conflict-resolver's WS grant) since webSocketStage already exists
    // locally within this same construct.
    props.inventoryRecordsTable.grantReadWriteData(this.conflictResolveFn);
    props.auditLogTable.grantWriteData(this.conflictResolveFn);
    props.wsConnectionsTable.grantReadData(this.conflictResolveFn);
    this.webSocketStage.grantManagementApiAccess(this.conflictResolveFn);

    this.httpApi.addRoutes({
      path: "/conflicts/{item_id}/resolve",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("ConflictResolveIntegration", this.conflictResolveFn),
    });

    new CfnOutput(this, "HttpApiUrl", { value: this.httpApi.apiEndpoint });
    new CfnOutput(this, "WebSocketUrl", { value: this.webSocketStage.callbackUrl });
  }
}
