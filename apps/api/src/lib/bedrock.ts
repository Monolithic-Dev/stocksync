import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { createLogger } from "./logger";

const logger = createLogger("bedrock");

// A few seconds, not the SDK default (which can run well past what's
// tolerable inside a single FIFO-group Lambda invocation) — see Phase 8's
// "Real-World Engineering Concerns": a hung Bedrock call must never create
// a hung invocation that delays the next queued message for this item.
const TIMEOUT_MS = 4000;
const MAX_TOKENS = 200;

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? "anthropic.claude-3-haiku-20240307-v1:0";

// senior-prompt-engineer/references/bedrock-prompt-templates.md §1 —
// verbatim. Asks for an explanation and "what to consider," never "which
// is correct" — see that doc's guardrail check before editing this string.
const SYSTEM_PROMPT =
  "You are a plain-language assistant explaining data conflicts in a small " +
  "shop's inventory system to a shop owner who is not technical. Be concise: " +
  "1-2 sentences. Describe the discrepancy and possible causes. Do not state " +
  "which value is correct — the owner will decide that.";

let client: BedrockRuntimeClient | undefined;
function getClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({});
  return client;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    const whole = Math.max(1, Math.round(seconds));
    return `${whole} second${whole === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function buildUserPrompt(
  fieldName: string,
  candidateA: ConflictCandidate,
  candidateB: ConflictCandidate,
  timeDeltaSeconds: number,
): string {
  return (
    `Two shop counters set different ${fieldName} for the same item while both were offline. ` +
    `${candidateA.counterId} set it to ${String(candidateA.value)}, ${candidateB.counterId} set it to ${String(candidateB.value)}, ` +
    `about ${formatDuration(timeDeltaSeconds)} apart. Explain this discrepancy in plain language and suggest what the owner ` +
    `should consider when picking the correct value.`
  );
}

function extractText(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null || !("content" in parsed)) return null;
  const content = (parsed as { content: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  const first = content[0] as { text?: unknown };
  return typeof first.text === "string" && first.text.trim().length > 0 ? first.text.trim() : null;
}

export interface ConflictCandidate {
  counterId: string;
  value: unknown;
}

/**
 * Explains a same-field conflict in plain language via Bedrock. Called
 * only from conflictResolver.ts, only after a genuine `needs_review`
 * conflict has already been detected and stored by packages/core's
 * resolve() — never to help decide whether something is a conflict.
 *
 * Never throws: a timeout, malformed response, or service error all
 * resolve to `null` (edge case G-1), since this call must never be the
 * reason a conflict fails to display. The raw candidate values are always
 * sufficient to resolve manually without this explanation.
 */
export async function explainPriceConflict(
  fieldName: string,
  candidateA: ConflictCandidate,
  candidateB: ConflictCandidate,
  timeDeltaSeconds: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await getClient().send(
      new InvokeModelCommand({
        modelId: MODEL_ID,
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserPrompt(fieldName, candidateA, candidateB, timeDeltaSeconds) }],
        }),
      }),
      { abortSignal: controller.signal },
    );

    const raw = Buffer.from(response.body ?? new Uint8Array()).toString("utf-8");
    const parsed: unknown = JSON.parse(raw);
    return extractText(parsed);
  } catch (error) {
    logger.error("Bedrock price-conflict explanation failed, continuing without one", { error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
