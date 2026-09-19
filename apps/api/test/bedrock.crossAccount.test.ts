import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bedrockMock = mockClient(BedrockRuntimeClient);
const secretsMock = mockClient(SecretsManagerClient);

function mockBedrockResponse(payload: unknown): never {
  return { body: new TextEncoder().encode(JSON.stringify(payload)) } as never;
}

// The cross-account workaround (see infra/cdk/lib/config.ts) reads its env
// vars once at module load, so each test here resets modules and re-imports
// with its own env — unlike bedrock.test.ts, which never sets these and
// exercises the same-account default path.
describe("explainPriceConflict — cross-account credentials path", () => {
  beforeEach(() => {
    bedrockMock.reset();
    secretsMock.reset();
    vi.resetModules();
    process.env.BEDROCK_CREDENTIALS_SECRET_ARN = "arn:aws:secretsmanager:us-east-1:509399625129:secret:test-secret";
    process.env.BEDROCK_INFERENCE_PROFILE_ARN =
      "arn:aws:bedrock:us-east-1:368339042048:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0";
  });

  afterEach(() => {
    delete process.env.BEDROCK_CREDENTIALS_SECRET_ARN;
    delete process.env.BEDROCK_INFERENCE_PROFILE_ARN;
  });

  it("fetches credentials from Secrets Manager and uses them to call Bedrock", async () => {
    secretsMock
      .on(GetSecretValueCommand)
      .resolves({ SecretString: JSON.stringify({ accessKeyId: "AKIAFAKE", secretAccessKey: "fake-secret" }) });
    bedrockMock
      .on(InvokeModelCommand)
      .resolves(mockBedrockResponse({ content: [{ type: "text", text: "Explained via the second account." }] }));

    const { explainPriceConflict } = await import("../src/lib/bedrock");
    const result = await explainPriceConflict("price", { counterId: "counter_a", value: 10 }, { counterId: "counter_b", value: 12 }, 300);

    expect(result).toBe("Explained via the second account.");
    expect(secretsMock.commandCalls(GetSecretValueCommand)).toHaveLength(1);
    expect(secretsMock.commandCalls(GetSecretValueCommand)[0].args[0].input.SecretId).toBe(
      process.env.BEDROCK_CREDENTIALS_SECRET_ARN,
    );
    expect(bedrockMock.commandCalls(InvokeModelCommand)[0].args[0].input.modelId).toBe(
      process.env.BEDROCK_INFERENCE_PROFILE_ARN,
    );
  });

  it("returns null, not a thrown exception, when the secret is missing the expected fields", async () => {
    secretsMock.on(GetSecretValueCommand).resolves({ SecretString: JSON.stringify({ unexpected: "shape" }) });

    const { explainPriceConflict } = await import("../src/lib/bedrock");
    const result = await explainPriceConflict("price", { counterId: "counter_a", value: 10 }, { counterId: "counter_b", value: 12 }, 300);

    expect(result).toBeNull();
  });

  it("returns null, not a thrown exception, when Secrets Manager itself errors", async () => {
    secretsMock.on(GetSecretValueCommand).rejects(new Error("access denied"));

    const { explainPriceConflict } = await import("../src/lib/bedrock");
    const result = await explainPriceConflict("price", { counterId: "counter_a", value: 10 }, { counterId: "counter_b", value: 12 }, 300);

    expect(result).toBeNull();
  });
});
