export const projectName = "stocksync";

// Single source of truth for both the conflict-resolver Lambda's env var
// and the IAM resource ARN scoping its bedrock:InvokeModel grant — the
// two must never drift apart, or the deployed function loses access to
// exactly the model it's configured to call.
export const bedrockModelId = "anthropic.claude-3-haiku-20240307-v1:0";
