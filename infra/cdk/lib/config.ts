export const projectName = "stocksync";

// Single source of truth for both the conflict-resolver Lambda's env var
// and the IAM resource ARN scoping its bedrock:InvokeModel grant — the
// two must never drift apart, or the deployed function loses access to
// exactly the model it's configured to call.
//
// claude-3-haiku-20240307-v1:0 has been fully retired from Bedrock's
// model catalog (confirmed via `aws bedrock list-foundation-models`
// against the real deployment account — it's simply absent, not just
// access-restricted). claude-haiku-4-5 is the current equivalent tier:
// fast/cheap, appropriate for this Lambda's non-blocking, 1-2 sentence
// conflict explanation, same as the original choice's intent.
export const bedrockModelId = "anthropic.claude-haiku-4-5-20251001-v1:0";
