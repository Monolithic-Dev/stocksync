import { SQSClient } from "@aws-sdk/client-sqs";

// SQS_ENDPOINT is set only in local/integration tests — absent in every
// real environment, where the SDK resolves against the real service.
export const sqs = new SQSClient(process.env.SQS_ENDPOINT ? { endpoint: process.env.SQS_ENDPOINT } : {});
