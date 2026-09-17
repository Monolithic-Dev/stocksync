import { RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

/**
 * The four Tier-1 DynamoDB tables — see docs/03-DATABASE-SCHEMA.md for the
 * full access-pattern rationale (AP-1 through AP-7). All on-demand billing
 * (no capacity planning needed at hackathon scale, sits inside the
 * always-free tier). Tables are exposed as public readonly properties so
 * Phase 4/5's Lambdas can call `.grantReadWriteData(...)` / `.grantWriteData(...)`
 * directly — least-privilege IAM per-Lambda, set up now even though no
 * Lambda exists yet to receive a grant.
 */
export class DataLayer extends Construct {
  public readonly inventoryRecordsTable: Table;
  public readonly writeDedupTable: Table;
  public readonly auditLogTable: Table;
  public readonly wsConnectionsTable: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Serves AP-1 (get an item's current state) and, via the GSI below, AP-7.
    // Streams feeds Phase 5's real-time push path.
    this.inventoryRecordsTable = new Table(this, "InventoryRecordsTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.inventoryRecordsTable.addGlobalSecondaryIndex({
      indexName: "ShopConflictIndex",
      partitionKey: { name: "shop_id", type: AttributeType.STRING },
      sortKey: { name: "conflict_status", type: AttributeType.STRING },
    });

    // Serves AP-2 (idempotency check). DynamoDB's native TTL on `ttl`
    // expires records 7 days after creation — no cleanup job needed.
    this.writeDedupTable = new Table(this, "WriteDedupTable", {
      partitionKey: { name: "idempotency_key", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Serves AP-3/AP-4 (append + chronological read via sk range query).
    this.auditLogTable = new Table(this, "AuditLogTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Serves AP-5/AP-6 (find/remove WebSocket connections for a shop).
    this.wsConnectionsTable = new Table(this, "WsConnectionsTable", {
      partitionKey: { name: "connection_id", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.wsConnectionsTable.addGlobalSecondaryIndex({
      indexName: "ShopConnectionsIndex",
      partitionKey: { name: "shop_id", type: AttributeType.STRING },
    });
  }
}
