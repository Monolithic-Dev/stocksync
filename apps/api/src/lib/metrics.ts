import { Metrics } from "@aws-lambda-powertools/metrics";

const NAMESPACE = "StockSync";

export function createMetrics(serviceName: string): Metrics {
  return new Metrics({ namespace: NAMESPACE, serviceName });
}
