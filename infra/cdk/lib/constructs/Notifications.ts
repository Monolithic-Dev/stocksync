import * as path from "node:path";
import { Duration } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime, StartingPosition } from "aws-cdk-lib/aws-lambda";
import { DynamoEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { EmailIdentity, Identity } from "aws-cdk-lib/aws-ses";
import type { UserPool } from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";
import { alertsFromEmail } from "../config";

export interface NotificationsProps {
  inventoryRecordsTable: Table;
  userPool: UserPool;
}

/**
 * Phase 4 — low-stock and conflict-needs-review email alerts. Consumes
 * inventory_records' DynamoDB Stream (enabled since Phase 1, never
 * actually wired to anything — see DataLayer.ts) rather than adding a new
 * write-path hook, so this is a pure read-side addition with zero risk to
 * the correctness-critical resolver pipeline.
 */
export class Notifications extends Construct {
  public readonly notifyAlertsFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: NotificationsProps) {
    super(scope, id);

    const emailIdentity = new EmailIdentity(this, "AlertsSenderIdentity", {
      identity: Identity.email(alertsFromEmail),
    });

    this.notifyAlertsFn = new NodejsFunction(this, "NotifyAlertsFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/notifyAlerts.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      environment: {
        USER_POOL_ID: props.userPool.userPoolId,
        SES_FROM_EMAIL: alertsFromEmail,
      },
    });

    this.notifyAlertsFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["cognito-idp:ListUsersInGroup"],
        resources: [props.userPool.userPoolArn],
      }),
    );
    this.notifyAlertsFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [emailIdentity.emailIdentityArn],
      }),
    );

    this.notifyAlertsFn.addEventSource(
      new DynamoEventSource(props.inventoryRecordsTable, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 10,
        retryAttempts: 2,
      }),
    );
  }
}
