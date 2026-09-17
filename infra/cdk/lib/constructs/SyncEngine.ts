import * as path from "node:path";
import { Duration, Stack } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { bedrockModelId } from "../config";

export interface SyncEngineProps {
  readonly writeDedupTable: Table;
  readonly inventoryRecordsTable: Table;
  readonly auditLogTable: Table;
  readonly wsConnectionsTable: Table;
}

/**
 * SQS FIFO write queue (MessageGroupId = record_id, never counter_id —
 * see senior-architect skill's "already caught" list) + DLQ, the
 * write-intake Lambda (Phase 4), and the conflict-resolver Lambda
 * (Phase 5) that consumes the queue and performs the actual merge via
 * packages/core's resolve().
 */
export class SyncEngine extends Construct {
  public readonly deadLetterQueue: Queue;
  public readonly writeQueue: Queue;
  public readonly writeIntakeFn: NodejsFunction;
  public readonly conflictResolverFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: SyncEngineProps) {
    super(scope, id);

    this.deadLetterQueue = new Queue(this, "DeadLetterQueue", {
      fifo: true,
    });

    // contentBasedDeduplication is deliberately false: dedup is handled
    // explicitly via MessageDeduplicationId set from the client's
    // idempotency key at send time — two structurally-identical but
    // independent transactions (e.g. two separate "sell 1 unit" actions)
    // must NOT be deduplicated against each other by SQS's content hash.
    this.writeQueue = new Queue(this, "WriteQueue", {
      fifo: true,
      contentBasedDeduplication: false,
      deadLetterQueue: {
        queue: this.deadLetterQueue,
        maxReceiveCount: 5,
      },
      visibilityTimeout: Duration.seconds(30),
    });

    this.writeIntakeFn = new NodejsFunction(this, "WriteIntakeFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/writeIntake.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: {
        WRITE_DEDUP_TABLE_NAME: props.writeDedupTable.tableName,
        WRITE_QUEUE_URL: this.writeQueue.queueUrl,
      },
    });

    // Least-privilege: write-intake can claim/check idempotency and
    // enqueue — nothing else. It must never be able to touch
    // inventory_records or audit_log directly (that's the
    // conflict-resolver's job).
    props.writeDedupTable.grantReadWriteData(this.writeIntakeFn);
    this.writeQueue.grantSendMessages(this.writeIntakeFn);

    this.conflictResolverFn = new NodejsFunction(this, "ConflictResolverFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/conflictResolver.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(20),
      environment: {
        INVENTORY_RECORDS_TABLE_NAME: props.inventoryRecordsTable.tableName,
        AUDIT_LOG_TABLE_NAME: props.auditLogTable.tableName,
        WRITE_DEDUP_TABLE_NAME: props.writeDedupTable.tableName,
        WS_CONNECTIONS_TABLE_NAME: props.wsConnectionsTable.tableName,
        BEDROCK_MODEL_ID: bedrockModelId,
        // WEBSOCKET_CALLBACK_URL is added at the stack level once
        // RealtimeApi's WebSocketStage exists — see stocksync-stack.ts.
      },
    });

    // Consumes the write queue directly (the queue delivers *intent*; this
    // Lambda performs the *resolution*). reportBatchItemFailures means a
    // malformed message is retried/DLQ'd on its own — it never fails the
    // whole batch and blocks other items' processing (edge case B-1/US-6).
    this.conflictResolverFn.addEventSource(
      new SqsEventSource(this.writeQueue, { reportBatchItemFailures: true }),
    );

    // Least-privilege, scoped exactly to what the resolver touches: full
    // read/write on the record it resolves, write-only on the audit trail,
    // and read-only on connections (it never creates/deletes a connection
    // row itself — that's wsConnect/wsDisconnect's job).
    props.inventoryRecordsTable.grantReadWriteData(this.conflictResolverFn);
    props.auditLogTable.grantWriteData(this.conflictResolverFn);
    props.writeDedupTable.grantReadWriteData(this.conflictResolverFn);
    props.wsConnectionsTable.grantReadData(this.conflictResolverFn);

    // Scoped to exactly the one foundation model this function is
    // configured to call (BEDROCK_MODEL_ID above) — never "*" (Phase 8's
    // price-conflict explainer, see senior-prompt-engineer skill).
    this.conflictResolverFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [`arn:aws:bedrock:${Stack.of(this).region}::foundation-model/${bedrockModelId}`],
      }),
    );
  }
}
