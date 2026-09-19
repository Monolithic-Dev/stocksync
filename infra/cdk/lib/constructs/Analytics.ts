import * as path from "node:path";
import { Duration } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import type { IHttpRouteAuthorizer } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface AnalyticsProps {
  readonly httpApi: HttpApi;
  readonly authorizer: IHttpRouteAuthorizer;
  readonly inventoryRecordsTable: Table;
  readonly ordersTable: Table;
}

/**
 * The owner-facing analytics dashboard (revenue rollups, low-stock alerts,
 * a trust-score reframing of the conflict rate). Deliberately a
 * read-only construct spanning two tables owned by other constructs
 * (DataLayer's inventory_records, PlatformCrud's orders) — see
 * dashboardQuery.ts's doc comment for why this reads existing tables
 * directly instead of adding a new rollup table or GSI.
 */
export class Analytics extends Construct {
  public readonly dashboardQueryFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: AnalyticsProps) {
    super(scope, id);

    this.dashboardQueryFn = new NodejsFunction(this, "DashboardQueryFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/dashboardQuery.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: {
        INVENTORY_RECORDS_TABLE_NAME: props.inventoryRecordsTable.tableName,
        ORDERS_TABLE_NAME: props.ordersTable.tableName,
      },
    });
    props.inventoryRecordsTable.grantReadData(this.dashboardQueryFn);
    props.ordersTable.grantReadData(this.dashboardQueryFn);

    props.httpApi.addRoutes({
      path: "/dashboard",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration("DashboardQueryIntegration", this.dashboardQueryFn),
      authorizer: props.authorizer,
    });
  }
}
