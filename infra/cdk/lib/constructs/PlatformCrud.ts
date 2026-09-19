import * as path from "node:path";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface PlatformCrudProps {
  readonly httpApi: HttpApi;
}

/**
 * Tier 2 catalog layer (19b, 03-DATABASE-SCHEMA.md §8.1-8.4): products,
 * categories, suppliers, and orders. Deliberately not built on
 * packages/core's CRDT machinery — this is static catalog metadata and
 * checkout receipts, not live, concurrently-edited inventory state, so
 * plain last-write-wins (apps/api/src/lib/crudTable.ts) is the correct,
 * deliberate choice — see senior-architect's guidance on when CRDT-level
 * rigor is and isn't warranted.
 */
export class PlatformCrud extends Construct {
  public readonly productsTable: Table;
  public readonly categoriesTable: Table;
  public readonly suppliersTable: Table;
  public readonly ordersTable: Table;
  public readonly checkoutFn: NodejsFunction;

  constructor(scope: Construct, id: string, props: PlatformCrudProps) {
    super(scope, id);

    // Serves AP-8. GSI-1 (CategoryIndex) lets /products?category_id=Y
    // filter without a table scan — see 03-DATABASE-SCHEMA.md §8.1.
    this.productsTable = new Table(this, "ProductsTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.productsTable.addGlobalSecondaryIndex({
      indexName: "CategoryIndex",
      partitionKey: { name: "category_id", type: AttributeType.STRING },
    });

    // Serves AP-9.
    this.categoriesTable = new Table(this, "CategoriesTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.suppliersTable = new Table(this, "SuppliersTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Serves AP-11. Checkout summary/receipt only — never a second
    // source of truth for stock (that's still inventory_records/audit_log).
    this.ordersTable = new Table(this, "OrdersTable", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      sortKey: { name: "sk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const productsFn = new NodejsFunction(this, "ProductsCrudFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/productsCrud.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { PRODUCTS_TABLE_NAME: this.productsTable.tableName },
    });
    this.productsTable.grantReadWriteData(productsFn);

    const categoriesFn = new NodejsFunction(this, "CategoriesCrudFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/categoriesCrud.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { CATEGORIES_TABLE_NAME: this.categoriesTable.tableName },
    });
    this.categoriesTable.grantReadWriteData(categoriesFn);

    const suppliersFn = new NodejsFunction(this, "SuppliersCrudFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/suppliersCrud.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { SUPPLIERS_TABLE_NAME: this.suppliersTable.tableName },
    });
    this.suppliersTable.grantReadWriteData(suppliersFn);

    for (const [pathPart, fn] of [
      ["products", productsFn],
      ["categories", categoriesFn],
      ["suppliers", suppliersFn],
    ] as const) {
      const integration = new HttpLambdaIntegration(`${pathPart}CrudIntegration`, fn);
      props.httpApi.addRoutes({ path: `/${pathPart}`, methods: [HttpMethod.GET, HttpMethod.POST], integration });
      props.httpApi.addRoutes({
        path: `/${pathPart}/{${pathPart.replace(/s$/, "")}_id}`,
        methods: [HttpMethod.PUT, HttpMethod.DELETE],
        integration,
      });
    }

    // checkout.ts calls writeIntake.ts's handler directly, in-process —
    // no new AWS surface for the actual stock-affecting write, so this
    // function needs write-intake's exact grants (write_dedup + SQS send)
    // plus its own write access to the orders summary table. Wired at the
    // stack level (stocksync-stack.ts), same cross-construct pattern the
    // conflict-resolver's WebSocket grant already uses, since write_dedup
    // and the write queue are owned by SyncEngine, not this construct.
    this.checkoutFn = new NodejsFunction(this, "CheckoutFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/checkout.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(15),
      environment: { ORDERS_TABLE_NAME: this.ordersTable.tableName },
    });
    this.ordersTable.grantWriteData(this.checkoutFn);

    props.httpApi.addRoutes({
      path: "/checkout",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("CheckoutIntegration", this.checkoutFn),
    });
  }
}
