# StockSync — Tech Stack

## 1. Guiding principle

One language, TypeScript, across the entire monorepo — frontend, backend
Lambda handlers, shared business logic, and infrastructure-as-code. This
isn't a stylistic preference; it has a concrete payoff for this specific
project: the `Transaction`, `InventoryRecord`, and `VectorClock` types
can be defined **once**, in `packages/core`, and imported everywhere they're
used, so the client, the Lambda, and the tests are all reasoning about
literally the same shape of data. It also means Claude Code doesn't have
to context-switch between languages within a single session, which
measurably reduces inconsistent code generation across a multi-day build.

---

## 2. The Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript (strict mode) everywhere | Type safety across the whole monorepo; one language to reason about |
| Frontend framework | React 18 + Vite | Fast dev server, minimal config, huge ecosystem, easy for Claude Code to generate idiomatic code for |
| Frontend hosting | AWS Amplify Hosting | Zero-config CI/CD for the React app — push to `main` and the frontend is live; no S3/CloudFront wiring needed at hackathon scale. **Coordination note:** this is a second, independent deploy mechanism alongside `cdk deploy` — the frontend needs `VITE_API_URL`/`VITE_WS_URL` pointing at whatever the CDK stack's API Gateway just output, so this must be wired deliberately (Amplify environment variables set from CDK outputs, or a manual update step) rather than assumed to happen automatically. See `06-FOLDER-STRUCTURE.md`'s `deploy.yml` for how this is sequenced. |
| Frontend styling | Tailwind CSS | Fast to iterate visually without hand-rolling CSS files — matters for the Best UI polish pass |
| Frontend offline storage | `idb` (a small Promise-based wrapper over IndexedDB) | Avoids hand-rolling the raw IndexedDB callback API |
| Frontend state | React Context + `useReducer` (no external state library) | The app's state shape is small and well-defined enough that Redux/Zustand would be unnecessary overhead for a 10-day build |
| Backend compute | AWS Lambda, Node.js 22.x runtime, TypeScript | Matches the monorepo language; cold-start is a non-issue at demo scale. (Node.js 20.x was AWS's LTS pick when this doc was first drafted, but it's now past its own deprecation date — 22.x is the current LTS as of Phase 4.) |
| AWS SDK | AWS SDK for JavaScript v3 (modular clients: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-apigatewaymanagementapi`, `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-transcribe`) | Modular imports keep Lambda bundle sizes small |
| Infrastructure as Code | AWS CDK (TypeScript) | Same language as the rest of the monorepo — infra, Lambda handlers, and shared types are all reasoned about in one language; type-safe constructs catch config mistakes at compile time instead of at deploy time. |
| Monorepo tooling | npm workspaces + Turborepo | Turborepo's task caching speeds up repeated `build`/`test` runs across packages, which matters when iterating fast over 10 days |
| Unit testing | Vitest | Fast, native TypeScript/ESM support, Jest-compatible API |
| Property-based testing | `fast-check` | Used specifically to prove the PN-Counter merge is commutative and associative — see `08-TESTING-STRATEGY.md` |
| End-to-end testing | Playwright | Can drive two independent browser contexts (simulating two counters) and toggle network conditions programmatically — exactly what's needed to test the core conflict scenario automatically, not just manually |
| Linting/formatting | ESLint + Prettier, shared config in `packages/config` | Consistency across every package without repeating config |
| CI/CD | GitHub Actions | Free for public/hackathon repos, simple to wire to `cdk deploy` and Amplify deploys |
| Observability | CloudWatch Logs (structured JSON via a tiny shared logger utility) + CloudWatch custom metrics | No need for anything heavier (e.g. X-Ray) at this scale |

---

## 3. Why CDK over SAM/Terraform

- **One language for the whole monorepo** — infra constructs, Lambda
  handlers, and shared types (`packages/core`) are all TypeScript; no
  context-switch into YAML for the infra layer, and no risk of a
  `template.yaml` silently drifting out of sync with the types it's
  supposed to describe.
- **Type-safe constructs** — a typo'd table name or a missing IAM grant
  is a compile-time error, not something discovered on `cdk deploy` (or
  worse, at runtime).
- **`NodejsFunction`'s built-in `esbuild` bundling** gives the same
  zero-separate-build-pipeline win SAM offers for TypeScript Lambda
  handlers, without leaving the CDK app.
- **Familiar, well-documented**, and already scaffolded — `infra/cdk/`
  exists and deploys empty as of Phase 1; there's no reason to pay a
  second tool's learning curve mid-build.
- CDK's App/Stack/Construct model also gives per-environment
  parameterization (see Section 10.10 of the architecture doc) for free
  via constructor props, without a second templating layer.

See the `aws-solution-architect` and `senior-devops` skills for the full
reasoning — this is a settled decision for this project, not an open
question to revisit per-feature.

---

## 4. Explicitly not used, and why

- **No ORM/database abstraction layer** over DynamoDB — at four tables
  with well-defined access patterns, a thin wrapper (`packages/core`'s
  data-access functions) is enough; a full ORM would add indirection
  without real benefit here.
- **No GraphQL** — the API surface is small and well-defined; REST +
  WebSocket covers every access pattern without the added complexity of
  a GraphQL schema/resolver layer.
- **No Redux/Zustand/MobX** — see state management row above.
- **No SageMaker or any custom ML model** — by design, per the PRD's
  explicit non-goals; Bedrock is used only as a pre-trained foundation
  model API call.
