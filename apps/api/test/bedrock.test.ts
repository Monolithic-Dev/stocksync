import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

let explainPriceConflict: typeof import("../src/lib/bedrock").explainPriceConflict;
const bedrockMock = mockClient(BedrockRuntimeClient);

beforeAll(async () => {
  ({ explainPriceConflict } = await import("../src/lib/bedrock"));
});

afterEach(() => {
  bedrockMock.reset();
});

// InvokeModelCommandOutput.body is typed as an SDK-internal blob adapter
// (IUint8ArrayBlobAdapter), not a plain Uint8Array — casting via `never`
// here is simpler than constructing that adapter type just for a mock.
function mockResponse(payload: unknown): never {
  return { body: new TextEncoder().encode(JSON.stringify(payload)) } as never;
}

describe("explainPriceConflict", () => {
  it("returns the model's text on a well-formed response", async () => {
    bedrockMock
      .on(InvokeModelCommand)
      .resolves(mockResponse({ content: [{ type: "text", text: "Both counters set a different price while offline." }] }));

    const result = await explainPriceConflict(
      "price",
      { counterId: "counter_a", value: 10 },
      { counterId: "counter_b", value: 12 },
      300,
    );

    expect(result).toBe("Both counters set a different price while offline.");
  });

  it("returns null, not a thrown exception, for a malformed response (edge case G-1)", async () => {
    bedrockMock.on(InvokeModelCommand).resolves(mockResponse({ unexpected: "shape" }));

    const result = await explainPriceConflict(
      "price",
      { counterId: "counter_a", value: 10 },
      { counterId: "counter_b", value: 12 },
      300,
    );

    expect(result).toBeNull();
  });

  it("returns null for an empty response body", async () => {
    bedrockMock.on(InvokeModelCommand).resolves(mockResponse({ content: [] }));

    const result = await explainPriceConflict(
      "price",
      { counterId: "counter_a", value: 10 },
      { counterId: "counter_b", value: 12 },
      300,
    );

    expect(result).toBeNull();
  });

  it("returns null, not a thrown exception, when the client itself errors", async () => {
    bedrockMock.on(InvokeModelCommand).rejects(new Error("service unavailable"));

    const result = await explainPriceConflict(
      "price",
      { counterId: "counter_a", value: 10 },
      { counterId: "counter_b", value: 12 },
      300,
    );

    expect(result).toBeNull();
  });
});
