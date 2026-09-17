import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// DYNAMODB_ENDPOINT is set only in local/integration tests (DynamoDB Local
// via dynalite) — absent in every real environment, where the SDK resolves
// the endpoint/region/credentials from the Lambda execution environment.
const client = new DynamoDBClient(
  process.env.DYNAMODB_ENDPOINT
    ? {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        region: "local",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
      }
    : {},
);

// Exported once and reused across invocations, not re-instantiated per call.
export const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
});
