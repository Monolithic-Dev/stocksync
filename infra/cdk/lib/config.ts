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

// The team AWS account this stack deploys into (509399625129) is blocked
// from invoking any Anthropic model on Bedrock by an account-level
// "Anthropic use-case details" approval gate — submitting that form itself
// returns "Your account is not authorized... create a support case," which
// requires Business/Enterprise support to file via CLI (this account is on
// Basic). A support case is pending, with no guaranteed resolution time.
//
// A second, unrelated AWS account (verified via a real invoke-model call —
// no such restriction) is used instead for exactly this one call. Its
// credentials live in Secrets Manager (see SyncEngine.ts's
// BedrockCrossAccountCredentials secret), populated out-of-band via the
// AWS CLI — never committed to source control.
export const bedrockCrossAccountId = "368339042048";
export const bedrockCrossAccountRegion = "us-east-1";
export const bedrockInferenceProfileArn =
  `arn:aws:bedrock:${bedrockCrossAccountRegion}:${bedrockCrossAccountId}:inference-profile/us.${bedrockModelId}`;
