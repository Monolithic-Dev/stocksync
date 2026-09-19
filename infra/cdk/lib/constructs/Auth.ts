import * as path from "node:path";
import { CfnOutput, Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { HttpJwtAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import {
  AccountRecovery,
  CfnUserPoolGroup,
  StringAttribute,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
} from "aws-cdk-lib/aws-cognito";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

/**
 * The three roles this product actually has (owner/manager/counter staff —
 * confirmed scope, not a guess). Modeled as Cognito Groups (not a custom
 * attribute) so membership shows up in the standard `cognito:groups` claim
 * on both the ID and access token without any extra wiring.
 */
export const ROLE_GROUPS = ["owner", "manager", "counter_staff"] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

/**
 * Real authentication (closes the gap `crudTable.ts` and 07-EDGE-CASES.md
 * E-1 both flag explicitly: "there is no Cognito/JWT layer yet... nothing
 * in Tier 1 enforces per-shop authorization either").
 *
 * Two ways a user ends up in this pool:
 *   1. Self-signup (SignUp -> ConfirmSignUp) — the client sets
 *      `custom:shop_id` itself at signup time (a brand-new shop), and
 *      postConfirmation.ts adds the confirmed user to the "owner" group.
 *      This is the one and only path into the "owner" group.
 *   2. Staff invite (`POST /staff`, staffInvite.ts, owner/manager-only) —
 *      AdminCreateUser + AdminAddUserToGroup("manager" | "counter_staff"),
 *      with `custom:shop_id` copied from the *inviting* user's own verified
 *      claim, never client-supplied — the only way this stays tenant-safe.
 *      AdminCreateUser never fires postConfirmation (that trigger is only
 *      for the self-service ConfirmSignUp flow), so staffInvite.ts sets
 *      the group itself, synchronously, in the same call.
 */
export class Auth extends Construct {
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly authorizer: HttpJwtAuthorizer;
  public readonly staffInviteFn: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.userPool = new UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      customAttributes: {
        shop_id: new StringAttribute({ mutable: true, minLen: 1, maxLen: 64 }),
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Matches every other data-bearing resource in this stack (DataLayer,
      // PlatformCrud) — this is a demo/hackathon-scale deployment, not a
      // production tenant we need to protect against `cdk destroy`.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.userPoolClient = this.userPool.addClient("WebClient", {
      // USER_PASSWORD_AUTH: the browser sends the password directly over
      // TLS via InitiateAuth — simpler than implementing SRP client-side
      // without Amplify, and consistent with this project's stated
      // preference for direct AWS SDK calls over pulling in a heavier
      // auth library. TLS is the actual protection here, same as any
      // standard login POST.
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });

    for (const groupName of ROLE_GROUPS) {
      new CfnUserPoolGroup(this, `${groupName}Group`, {
        userPoolId: this.userPool.userPoolId,
        groupName,
      });
    }

    const postConfirmationFn = new NodejsFunction(this, "PostConfirmationFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/postConfirmation.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
    });
    postConfirmationFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["cognito-idp:AdminAddUserToGroup"],
        // Not `this.userPool.userPoolArn` — that Fn::GetAtt would create a
        // CloudFormation dependency cycle (UserPool -> this trigger Lambda
        // via LambdaConfig -> this Lambda's IAM policy -> back to
        // UserPool), since CDK also auto-adds a Function -> Policy
        // dependency for IAM-propagation safety. Scoping to "every user
        // pool in this account/region" instead of this one specific pool
        // costs nothing here — there is exactly one pool in this stack —
        // and account/region are Stack-level values, not resource
        // attributes, so referencing them creates no such cycle.
        resources: [Stack.of(this).formatArn({ service: "cognito-idp", resource: "userpool", resourceName: "*" })],
      }),
    );
    this.userPool.addTrigger(UserPoolOperation.POST_CONFIRMATION, postConfirmationFn);

    // The HTTP API's JWT authorizer — RealtimeApi/PlatformCrud attach this
    // to every route at the stack level, once both this construct and
    // theirs exist (same cross-construct pattern the Bedrock WebSocket
    // grant already uses in stocksync-stack.ts).
    this.authorizer = new HttpJwtAuthorizer("JwtAuthorizer", this.userPool.userPoolProviderUrl, {
      jwtAudience: [this.userPoolClient.userPoolClientId],
    });

    this.staffInviteFn = new NodejsFunction(this, "StaffInviteFunction", {
      entry: path.join(__dirname, "../../../../apps/api/src/handlers/staffInvite.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(10),
      environment: { USER_POOL_ID: this.userPool.userPoolId },
    });
    this.staffInviteFn.addToRolePolicy(
      new PolicyStatement({
        actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminUpdateUserAttributes"],
        resources: [this.userPool.userPoolArn],
      }),
    );

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
  }
}
