#!/usr/bin/env python3
"""
Fullstack Project Scaffolder

Generates project structure and boilerplate for various fullstack architectures.
Supports Next.js, FastAPI+React, MERN, Django+React, and more.

Usage:
    python project_scaffolder.py nextjs my-app
    python project_scaffolder.py fastapi-react my-api --with-docker
    python project_scaffolder.py mern my-project --with-auth
    python project_scaffolder.py --list-templates
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, List, Optional


# Project templates with file structures
TEMPLATES = {
    "nextjs": {
        "name": "Next.js Full Stack",
        "description": "Next.js 14+ with App Router, TypeScript, Tailwind CSS",
        "structure": {
            "src/app": ["layout.tsx", "page.tsx", "globals.css", "api/health/route.ts"],
            "src/components/ui": ["Button.tsx", "Card.tsx", "Input.tsx"],
            "src/components/layout": ["Header.tsx", "Footer.tsx"],
            "src/lib": ["utils.ts", "db.ts"],
            "src/types": ["index.ts"],
            "public": [],
            "": ["package.json", "tsconfig.json", "tailwind.config.ts", "next.config.js",
                 ".env.example", ".gitignore", "README.md"]
        }
    },
    "fastapi-react": {
        "name": "FastAPI + React",
        "description": "FastAPI backend with React frontend, PostgreSQL",
        "structure": {
            "backend/app": ["__init__.py", "main.py", "config.py", "database.py"],
            "backend/app/api": ["__init__.py", "routes.py", "deps.py"],
            "backend/app/models": ["__init__.py", "user.py"],
            "backend/app/schemas": ["__init__.py", "user.py"],
            "backend": ["requirements.txt", "alembic.ini", "Dockerfile"],
            "frontend/src": ["App.tsx", "main.tsx", "index.css"],
            "frontend/src/components": ["Layout.tsx"],
            "frontend/src/hooks": ["useApi.ts"],
            "frontend": ["package.json", "tsconfig.json", "vite.config.ts", "Dockerfile"],
            "": ["docker-compose.yml", ".env.example", ".gitignore", "README.md"]
        }
    },
    "mern": {
        "name": "MERN Stack",
        "description": "MongoDB, Express, React, Node.js with TypeScript",
        "structure": {
            "server/src": ["index.ts", "config.ts", "database.ts"],
            "server/src/routes": ["index.ts", "users.ts"],
            "server/src/models": ["User.ts"],
            "server/src/middleware": ["auth.ts", "error.ts"],
            "server": ["package.json", "tsconfig.json", "Dockerfile"],
            "client/src": ["App.tsx", "main.tsx"],
            "client/src/components": ["Layout.tsx"],
            "client/src/services": ["api.ts"],
            "client": ["package.json", "tsconfig.json", "vite.config.ts", "Dockerfile"],
            "": ["docker-compose.yml", ".env.example", ".gitignore", "README.md"]
        }
    },
    "django-react": {
        "name": "Django + React",
        "description": "Django REST Framework backend with React frontend",
        "structure": {
            "backend/config": ["__init__.py", "settings.py", "urls.py", "wsgi.py"],
            "backend/apps/users": ["__init__.py", "models.py", "serializers.py", "views.py", "urls.py"],
            "backend": ["manage.py", "requirements.txt", "Dockerfile"],
            "frontend/src": ["App.tsx", "main.tsx"],
            "frontend/src/components": ["Layout.tsx"],
            "frontend": ["package.json", "tsconfig.json", "vite.config.ts", "Dockerfile"],
            "": ["docker-compose.yml", ".env.example", ".gitignore", "README.md"]
        }
    },
    "aws-serverless-cdk": {
        "name": "AWS Serverless (Lambda + DynamoDB + CDK)",
        "description": "TypeScript monorepo: React/Vite frontend, Lambda backend (no framework, AWS Lambda Powertools), DynamoDB, API Gateway REST+WebSocket, CDK IaC. Scaffolds a framework-free shared 'core' package for correctness-critical business logic (vector clocks + CRDT PN-Counter merge), matching the aws-serverless-hackathon profile.",
        "structure": {
            "apps/web/src": ["App.tsx", "main.tsx", "index.css"],
            "apps/web/src/offline": ["db.ts"],
            "apps/web": ["package.json", "vite.config.ts", "tsconfig.json", "index.html"],
            "apps/api/src/handlers": ["writeIntake.ts", "conflictResolver.ts"],
            "apps/api/src/lib": ["dynamo.ts", "logger.ts"],
            "apps/api": ["package.json", "tsconfig.json"],
            "packages/core/src": ["types.ts", "vectorClock.ts", "pnCounter.ts", "conflictResolution.ts", "index.ts"],
            "packages/core/tests": ["pnCounter.property.test.ts"],
            "packages/core": ["package.json", "tsconfig.json"],
            "infra/cdk/bin": ["app.ts"],
            "infra/cdk/lib": ["stack.ts"],
            "infra/cdk": ["cdk.json", "package.json", "tsconfig.json"],
            "": ["package.json", "tsconfig.base.json", ".gitignore", "README.md", ".env.example"]
        }
    }
}


def get_aws_serverless_content(filepath: str, project_name: str) -> Optional[str]:
    """
    Content overrides specific to the aws-serverless-cdk template.

    Gated by template (called only when template == "aws-serverless-cdk")
    because several filenames here — package.json, tsconfig.json, index.ts,
    db.ts — are already defined generically below for the other templates,
    with content that would be wrong here (e.g. the shared "package.json"
    entry hardcodes Next.js dependencies).
    """
    p = filepath.replace("\\", "/")  # normalize on Windows

    if p == "package.json":  # workspace root
        return f'''{{
  "name": "{project_name}",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "infra/*"],
  "scripts": {{
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "deploy": "npm run build --workspace=infra/cdk && npm run deploy --workspace=infra/cdk"
  }},
  "devDependencies": {{
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }}
}}
'''
    if p == "tsconfig.base.json":
        return '''{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
'''
    if p == ".gitignore":
        return '''node_modules/
dist/
cdk.out/
.cdk.staging/
*.d.ts
.env
.env.local
.turbo/
.DS_Store
'''
    if p == ".env.example":
        return '''# Populated after your first `cdk deploy` — see infra/cdk output
VITE_API_URL=
VITE_WS_URL=
'''
    if p == "README.md":
        return f'''# {project_name}

Scaffolded with the `aws-serverless-cdk` template — see
`docs/` (if present) for the full architecture. Quick start:

```bash
npm install
npm run build --workspace=packages/core
npm test --workspace=packages/core   # fast, no AWS needed — pure logic tests
cd infra/cdk && npx cdk deploy        # provisions DynamoDB, Lambda, API Gateway
cd ../../apps/web && npm run dev      # point VITE_API_URL/VITE_WS_URL at the deploy output
```

`packages/core` holds the framework-free conflict-resolution logic
(vector clocks + CRDT PN-Counter merge). `apps/api`'s Lambda handlers are
thin adapters around it — see `packages/core/src/conflictResolution.ts`
before editing either.
'''
    if p.startswith("apps/web") and Path(p).name == "package.json":
        return f'''{{
  "name": "{project_name}-web",
  "private": true,
  "scripts": {{ "dev": "vite", "build": "vite build", "lint": "eslint src" }},
  "dependencies": {{
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "idb": "^8.0.0"
  }},
  "devDependencies": {{
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "tailwindcss": "^3.4.0"
  }}
}}
'''
    if p.startswith("apps/web") and Path(p).name == "tsconfig.json":
        return '''{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["DOM", "ES2022"] },
  "include": ["src"]
}
'''
    if p.startswith("apps/web") and Path(p).name == "index.html":
        return f'''<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>{project_name}</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
'''
    if "offline" in p and Path(p).name == "db.ts":
        return '''// Local offline write queue (IndexedDB via idb) — replayed on reconnect.
// This is intentionally dumb: it queues, it does not resolve conflicts.
// All resolution logic lives server-side in packages/core, never here.
import { openDB, type DBSchema } from "idb";

interface QueueDB extends DBSchema {
  pending_transactions: {
    key: string; // idempotency_key
    value: { idempotencyKey: string; payload: unknown; createdAt: string };
  };
}

const dbPromise = openDB<QueueDB>("offline-queue", 1, {
  upgrade(db) {
    db.createObjectStore("pending_transactions", { keyPath: "idempotencyKey" });
  },
});

export async function enqueue(idempotencyKey: string, payload: unknown) {
  const db = await dbPromise;
  await db.put("pending_transactions", { idempotencyKey, payload, createdAt: new Date().toISOString() });
}

export async function listPending() {
  const db = await dbPromise;
  return db.getAll("pending_transactions");
}

export async function clearPending(idempotencyKey: string) {
  const db = await dbPromise;
  await db.delete("pending_transactions", idempotencyKey);
}
'''
    if p.startswith("apps/api") and Path(p).name == "package.json":
        return f'''{{
  "name": "{project_name}-api",
  "private": true,
  "scripts": {{ "build": "tsc", "test": "vitest run" }},
  "dependencies": {{
    "@aws-lambda-powertools/logger": "^2.0.0",
    "@aws-lambda-powertools/idempotency": "^2.0.0",
    "@aws-sdk/client-dynamodb": "^3.500.0",
    "@aws-sdk/lib-dynamodb": "^3.500.0",
    "@aws-sdk/client-bedrock-runtime": "^3.500.0",
    "core": "*"
  }},
  "devDependencies": {{ "@types/aws-lambda": "^8.10.0", "typescript": "^5.4.0", "vitest": "^1.5.0" }}
}}
'''
    if p.startswith("apps/api") and Path(p).name == "tsconfig.json":
        return '''{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "CommonJS", "outDir": "dist", "lib": ["ES2022"] },
  "include": ["src"]
}
'''
    if "handlers" in p and Path(p).name == "writeIntake.ts":
        return '''// Thin adapter: validate, check idempotency, enqueue. No merge logic here —
// see packages/core/src/conflictResolution.ts for that. This handler must
// stay thin; if you find yourself writing merge logic in this file, it
// belongs in packages/core instead.
import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
// import { resolve } from "core"; // packages/core — intentionally not called here;
// this Lambda's only job is dedup + enqueue, resolution happens downstream.

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const body = JSON.parse(event.body ?? "{}");

  // TODO: check write_dedup table by body.idempotency_key before enqueueing
  // TODO: enqueue to SQS FIFO with MessageGroupId = body.record_id (NOT the
  //       sender's client/counter id — grouping by sender allows two
  //       concurrent writers to race on the same record; see ARCHITECTURE.md)

  return { statusCode: 200, body: JSON.stringify({ status: "queued" }) };
};
'''
    if "handlers" in p and Path(p).name == "conflictResolver.ts":
        return '''// Thin adapter around packages/core's pure resolution logic.
// This is the ONLY place that should call DynamoDB TransactWriteItems for
// the core record + audit_log + write_dedup — keep those three writes atomic.
import type { DynamoDBStreamHandler } from "aws-lambda";
import { resolve } from "core";

export const handler: DynamoDBStreamHandler = async (event) => {
  for (const record of event.Records) {
    // TODO: load current state, call resolve(currentState, incomingWrite)
    //       from packages/core, then TransactWriteItems the result.
    void resolve; // placeholder reference so the import isn't flagged unused
  }
};
'''
    if "lib" in p and Path(p).name == "dynamo.ts":
        return '''import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
export const ddb = DynamoDBDocumentClient.from(client);
'''
    if "lib" in p and Path(p).name == "logger.ts":
        return '''import { Logger } from "@aws-lambda-powertools/logger";
export const logger = new Logger({ serviceName: process.env.SERVICE_NAME ?? "api" });
'''
    if p.startswith("packages/core") and Path(p).name == "package.json":
        return f'''{{
  "name": "core",
  "private": true,
  "main": "src/index.ts",
  "scripts": {{ "test": "vitest run", "test:watch": "vitest" }},
  "devDependencies": {{ "typescript": "^5.4.0", "vitest": "^1.5.0", "fast-check": "^3.17.0" }}
}}
'''
    if p.startswith("packages/core") and Path(p).name == "tsconfig.json":
        return '''{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "declaration": true, "outDir": "dist" },
  "include": ["src"]
}
'''
    if p.startswith("packages/core") and Path(p).name == "index.ts":
        return '''export * from "./types";
export * from "./vectorClock";
export * from "./pnCounter";
export * from "./conflictResolution";
'''
    if Path(p).name == "types.ts" and p.startswith("packages/core"):
        return '''export type VectorClock = Record<string, number>;

export interface PNCounterState {
  increments: Record<string, number>;
  decrements: Record<string, number>;
}

export interface RecordState {
  fields: Record<string, unknown>;
  fieldLastWriter: Record<string, string>;
  vectorClock: VectorClock;
  pnCounter?: PNCounterState;
}

export interface IncomingWrite {
  clientId: string;
  vectorClock: VectorClock;
  fields?: Record<string, unknown>;
  counterDelta?: { type: "increment" | "decrement"; amount: number };
}
'''
    if Path(p).name == "vectorClock.ts" and p.startswith("packages/core"):
        return '''import type { VectorClock } from "./types";

/** True if `a` has seen everything `b` has seen, and at least one more. */
export function dominates(a: VectorClock, b: VectorClock): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let strictlyGreater = false;
  for (const k of keys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av < bv) return false;
    if (av > bv) strictlyGreater = true;
  }
  return strictlyGreater;
}

export function isConcurrent(a: VectorClock, b: VectorClock): boolean {
  return !dominates(a, b) && !dominates(b, a) && JSON.stringify(a) !== JSON.stringify(b);
}

export function merge(a: VectorClock, b: VectorClock): VectorClock {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: VectorClock = {};
  for (const k of keys) out[k] = Math.max(a[k] ?? 0, b[k] ?? 0);
  return out;
}
'''
    if Path(p).name == "pnCounter.ts" and p.startswith("packages/core"):
        return '''import type { PNCounterState } from "./types";

/** A PN-Counter's value is always sum(increments) - sum(decrements) —
 *  correct regardless of the order operations from different clients
 *  arrive in. This is what makes it commutative and associative; see
 *  tests/pnCounter.property.test.ts for a proof via property-based testing. */
export function value(state: PNCounterState): number {
  const inc = Object.values(state.increments).reduce((a, b) => a + b, 0);
  const dec = Object.values(state.decrements).reduce((a, b) => a + b, 0);
  return inc - dec;
}

export function applyDelta(
  state: PNCounterState,
  clientId: string,
  type: "increment" | "decrement",
  amount: number
): PNCounterState {
  const bucket = type === "increment" ? "increments" : "decrements";
  return {
    ...state,
    [bucket]: { ...state[bucket], [clientId]: (state[bucket][clientId] ?? 0) + amount },
  };
}

export function merge(a: PNCounterState, b: PNCounterState): PNCounterState {
  const mergeBucket = (x: Record<string, number>, y: Record<string, number>) => {
    const out: Record<string, number> = { ...x };
    for (const [k, v] of Object.entries(y)) out[k] = Math.max(out[k] ?? 0, v);
    return out;
  };
  return { increments: mergeBucket(a.increments, b.increments), decrements: mergeBucket(a.decrements, b.decrements) };
}
'''
    if Path(p).name == "conflictResolution.ts" and p.startswith("packages/core"):
        return '''import type { RecordState, IncomingWrite } from "./types";
import { dominates, isConcurrent, merge as mergeClock } from "./vectorClock";
import { applyDelta, merge as mergePNCounter } from "./pnCounter";

export type ResolutionResult =
  | { kind: "applied"; state: RecordState }
  | { kind: "needs_review"; field: string; candidates: unknown[] };

/**
 * The whole point of this project lives here. Keep this function pure —
 * no AWS SDK calls, no I/O — so it can be tested exhaustively and fast.
 * Lambda handlers (apps/api) are thin wrappers around this.
 */
export function resolve(current: RecordState, incoming: IncomingWrite): ResolutionResult {
  if (dominates(incoming.vectorClock, current.vectorClock)) {
    // Clean apply: no concurrent writer to reconcile against.
    let next = { ...current, vectorClock: mergeClock(current.vectorClock, incoming.vectorClock) };
    if (incoming.counterDelta && next.pnCounter) {
      next = { ...next, pnCounter: applyDelta(next.pnCounter, incoming.clientId, incoming.counterDelta.type, incoming.counterDelta.amount) };
    }
    if (incoming.fields) {
      next = { ...next, fields: { ...next.fields, ...incoming.fields } };
    }
    return { kind: "applied", state: next };
  }

  if (isConcurrent(incoming.vectorClock, current.vectorClock)) {
    // Counter deltas always merge safely — that's the CRDT guarantee.
    if (incoming.counterDelta && current.pnCounter) {
      const merged = mergePNCounter(current.pnCounter, {
        increments: incoming.counterDelta.type === "increment" ? { [incoming.clientId]: incoming.counterDelta.amount } : {},
        decrements: incoming.counterDelta.type === "decrement" ? { [incoming.clientId]: incoming.counterDelta.amount } : {},
      });
      return { kind: "applied", state: { ...current, pnCounter: merged, vectorClock: mergeClock(current.vectorClock, incoming.vectorClock) } };
    }
    // Field writes: only a real conflict if the SAME field was touched
    // with a DIFFERENT value. Disjoint fields merge without conflict.
    if (incoming.fields) {
      for (const [field, value] of Object.entries(incoming.fields)) {
        if (current.fieldLastWriter[field] && current.fields[field] !== value) {
          return { kind: "needs_review", field, candidates: [current.fields[field], value] };
        }
      }
      return { kind: "applied", state: { ...current, fields: { ...current.fields, ...incoming.fields }, vectorClock: mergeClock(current.vectorClock, incoming.vectorClock) } };
    }
  }

  return { kind: "applied", state: current };
}
'''
    if Path(p).name == "pnCounter.property.test.ts":
        return '''import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { value, applyDelta, merge } from "../src/pnCounter";
import type { PNCounterState } from "../src/types";

const empty: PNCounterState = { increments: {}, decrements: {} };

describe("PN-Counter commutativity (the actual correctness guarantee)", () => {
  it("applying the same operations in any order yields the same value", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ clientId: fc.constantFrom("a", "b", "c"), type: fc.constantFrom("increment", "decrement"), amount: fc.integer({ min: 1, max: 20 }) })),
        (ops) => {
          const applyAll = (order: typeof ops) =>
            order.reduce((state, op) => applyDelta(state, op.clientId, op.type as "increment" | "decrement", op.amount), empty);

          const forward = applyAll(ops);
          const reversed = applyAll([...ops].reverse());

          // Merging two independently-built states should match applying
          // everything to one — this is the commutativity property a
          // PN-Counter is supposed to guarantee by construction.
          expect(value(forward)).toBe(value(reversed));
          expect(value(merge(forward, empty))).toBe(value(forward));
        }
      )
    );
  });
});
'''
    if Path(p).name == "cdk.json":
        return f'''{{
  "app": "npx ts-node --prefer-ts-exts bin/app.ts",
  "context": {{ "projectName": "{project_name}" }}
}}
'''
    if p.startswith("infra/cdk") and Path(p).name == "package.json":
        return f'''{{
  "name": "{project_name}-infra",
  "private": true,
  "scripts": {{ "deploy": "cdk deploy", "diff": "cdk diff", "synth": "cdk synth" }},
  "devDependencies": {{
    "aws-cdk": "^2.140.0",
    "aws-cdk-lib": "^2.140.0",
    "constructs": "^10.3.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.4.0"
  }}
}}
'''
    if p.startswith("infra/cdk") and Path(p).name == "tsconfig.json":
        return '''{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "module": "CommonJS", "lib": ["ES2022"] },
  "include": ["bin", "lib"]
}
'''
    if Path(p).name == "app.ts" and p.startswith("infra/cdk"):
        return '''#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { AppStack } from "../lib/stack";

const app = new App();
new AppStack(app, `${app.node.tryGetContext("projectName")}-stack`);
'''
    if Path(p).name == "stack.ts" and p.startswith("infra/cdk"):
        return '''import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
// import * as lambda from "aws-cdk-lib/aws-lambda";
// import * as apigateway from "aws-cdk-lib/aws-apigatewayv2";
// import * as sqs from "aws-cdk-lib/aws-sqs";

export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // TODO, in this order (see ARCHITECTURE.md):
    // 1. DynamoDB tables (records, write_dedup, audit_log, ws_connections)
    // 2. SQS FIFO queue, MessageGroupId will be the affected record's id
    //    (NOT the sending client's id — see the note in writeIntake.ts)
    //    + a Dead-Letter Queue attached to it
    // 3. Lambda: write-intake, granted write access to write_dedup + SQS only
    // 4. Lambda: conflict-resolver, granted TransactWriteItems on the 3
    //    core tables — least privilege, not blanket DynamoDB access
    // 5. API Gateway REST route -> write-intake; WebSocket route -> push
  }
}
'''

    return None


def get_file_content(template: str, filepath: str, project_name: str) -> str:
    """Generate file content based on template and file type."""
    if template == "aws-serverless-cdk":
        override = get_aws_serverless_content(filepath, project_name)
        if override is not None:
            return override

    filename = Path(filepath).name

    contents = {
        # Next.js files
        "layout.tsx": f'''import type {{ Metadata }} from "next";
import "./globals.css";

export const metadata: Metadata = {{
  title: "{project_name}",
  description: "Generated by project scaffolder",
}};

export default function RootLayout({{
  children,
}}: {{
  children: React.ReactNode;
}}) {{
  return (
    <html lang="en">
      <body>{{children}}</body>
    </html>
  );
}}
''',
        "page.tsx": f'''export default function Home() {{
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-4xl font-bold">{project_name}</h1>
      <p className="mt-4 text-gray-600">Welcome to your new project.</p>
    </main>
  );
}}
''',
        "globals.css": '''@tailwind base;
@tailwind components;
@tailwind utilities;
''',
        "route.ts": '''import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
}
''',
        "Button.tsx": '''import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", ...props }, ref) => {
    const base = "font-medium rounded-lg transition-colors";
    const variants = {
      primary: "bg-blue-600 text-white hover:bg-blue-700",
      secondary: "bg-gray-200 text-gray-900 hover:bg-gray-300",
      outline: "border border-gray-300 hover:bg-gray-50",
    };
    const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2", lg: "px-6 py-3 text-lg" };
    return <button ref={ref} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
  }
);
Button.displayName = "Button";
''',
        "Card.tsx": '''interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div className={`rounded-lg border bg-white p-6 shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
}
''',
        "Input.tsx": '''import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => (
    <div className="space-y-1">
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <input
        ref={ref}
        className={`w-full rounded-md border px-3 py-2 ${error ? "border-red-500" : "border-gray-300"} ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  )
);
Input.displayName = "Input";
''',
        "Header.tsx": f'''import Link from "next/link";

export function Header() {{
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-7xl items-center justify-between p-4">
        <Link href="/" className="text-xl font-bold">{project_name}</Link>
        <div className="flex gap-4">
          <Link href="/about" className="hover:text-blue-600">About</Link>
        </div>
      </nav>
    </header>
  );
}}
''',
        "Footer.tsx": '''export function Footer() {
  return (
    <footer className="border-t py-8 text-center text-sm text-gray-500">
      <p>&copy; {new Date().getFullYear()} All rights reserved.</p>
    </footer>
  );
}
''',
        "utils.ts": '''export function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric",
  }).format(date);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
''',
        "db.ts": '''// Database connection (Prisma example)
// import { PrismaClient } from "@prisma/client";
// export const db = new PrismaClient();

export const db = {
  // Placeholder - configure your database
};
''',
        "index.ts": '''export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export interface ApiResponse<T> {
  data: T;
  error: string | null;
  success: boolean;
}
''',
        # FastAPI files
        "main.py": f'''from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router
from app.config import settings

app = FastAPI(title="{project_name}", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

@app.get("/health")
async def health_check():
    return {{"status": "healthy"}}
''',
        "config.py": '''from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://user:pass@localhost:5432/db"
    ALLOWED_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:5173"]
    SECRET_KEY: str = "change-me-in-production"  # ⚠️ SCAFFOLDING PLACEHOLDER — replace before deployment

    class Config:
        env_file = ".env"

settings = Settings()
''',
        "database.py": '''from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from app.config import settings

engine = create_engine(settings.DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
''',
        "routes.py": '''from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter()

@router.get("/users")
async def get_users(db: Session = Depends(get_db)):
    return {"users": []}

@router.post("/users")
async def create_user(db: Session = Depends(get_db)):
    return {"message": "User created"}
''',
        "deps.py": '''from typing import Generator
from fastapi import Depends
from sqlalchemy.orm import Session
from app.database import get_db

def get_current_user():
    # Implement authentication
    pass
''',
        "user.py": '''from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from app.database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    name = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
''',
        "requirements.txt": '''fastapi>=0.104.0
uvicorn[standard]>=0.24.0
sqlalchemy>=2.0.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
alembic>=1.12.0
psycopg2-binary>=2.9.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.0
''',
        "alembic.ini": '''[alembic]
script_location = alembic
sqlalchemy.url = driver://user:pass@localhost/dbname
''',
        # Express files
        "index.ts": '''import express from "express";
import cors from "cors";
import helmet from "helmet";
import routes from "./routes";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use("/api", routes);

app.get("/health", (_, res) => res.json({ status: "healthy" }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
''',
        "config.ts": '''export const config = {
  PORT: parseInt(process.env.PORT || "8000"),
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/app",
  JWT_SECRET: process.env.JWT_SECRET || "change-me",
};
''',
        "database.ts": '''import mongoose from "mongoose";
import { config } from "./config";

export async function connectDatabase(): Promise<void> {
  await mongoose.connect(config.MONGODB_URI);
  console.log("Connected to MongoDB");
}
''',
        "users.ts": '''import { Router } from "express";
const router = Router();

router.get("/", async (req, res) => {
  res.json({ users: [] });
});

router.post("/", async (req, res) => {
  res.status(201).json({ message: "User created" });
});

export default router;
''',
        "User.ts": '''import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  name?: string;
  createdAt: Date;
}

const userSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true },
  name: String,
}, { timestamps: true });

export const User = mongoose.model<IUser>("User", userSchema);
''',
        "auth.ts": '''import { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  // Verify token
  next();
}
''',
        "error.ts": '''import { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
}
''',
        # React/Vite files
        "App.tsx": f'''function App() {{
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="container mx-auto p-4">
        <h1 className="text-3xl font-bold">{project_name}</h1>
        <p className="mt-4 text-gray-600">Welcome to your new project.</p>
      </main>
    </div>
  );
}}
export default App;
''',
        "main.tsx": '''import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>
);
''',
        "index.css": '''@tailwind base;
@tailwind components;
@tailwind utilities;
''',
        "Layout.tsx": f'''import {{ ReactNode }} from "react";

export function Layout({{ children }}: {{ children: ReactNode }}) {{
  return (
    <div className="min-h-screen">
      <header className="border-b p-4">
        <a href="/" className="text-xl font-bold">{project_name}</a>
      </header>
      <main>{{children}}</main>
    </div>
  );
}}
''',
        "useApi.ts": '''import { useState, useCallback } from "react";

export function useApi<T>(baseUrl = "/api") {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (endpoint: string, options?: RequestInit) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}${endpoint}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      throw e;
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  return { data, loading, error, request };
}
''',
        "api.ts": '''const API_BASE = import.meta.env.VITE_API_URL || "/api";

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),
  post: <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(endpoint: string, body: unknown) => request<T>(endpoint, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T>(endpoint: string) => request<T>(endpoint, { method: "DELETE" }),
};
''',
        "vite.config.ts": '''import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});
''',
        # Django files
        "settings.py": f'''from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "change-me")
DEBUG = os.environ.get("DEBUG", "True") == "True"
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "apps.users",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {{
    "default": {{
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("DB_NAME", "app"),
        "USER": os.environ.get("DB_USER", "user"),
        "PASSWORD": os.environ.get("DB_PASSWORD", "password"),
        "HOST": os.environ.get("DB_HOST", "localhost"),
        "PORT": "5432",
    }}
}}

CORS_ALLOWED_ORIGINS = ["http://localhost:5173"]
''',
        "urls.py": '''from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.users.urls")),
]
''',
        "wsgi.py": '''import os
from django.core.wsgi import get_wsgi_application
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
''',
        "models.py": '''from django.contrib.auth.models import AbstractUser
from django.db import models

class User(AbstractUser):
    email = models.EmailField(unique=True)
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]
''',
        "serializers.py": '''from rest_framework import serializers
from .models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "username", "date_joined"]
''',
        "views.py": '''from rest_framework import viewsets
from .models import User
from .serializers import UserSerializer

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all()
    serializer_class = UserSerializer
''',
        "manage.py": '''#!/usr/bin/env python
import os
import sys

def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)

if __name__ == "__main__":
    main()
''',
        # Config files
        "package.json": f'''{{"name": "{project_name}", "version": "0.1.0", "private": true,
  "scripts": {{"dev": "next dev", "build": "next build", "start": "next start", "lint": "next lint"}},
  "dependencies": {{"next": "^14.0.0", "react": "^18.2.0", "react-dom": "^18.2.0"}},
  "devDependencies": {{"@types/node": "^20.0.0", "@types/react": "^18.2.0", "typescript": "^5.0.0", "tailwindcss": "^3.3.0", "autoprefixer": "^10.4.0", "postcss": "^8.4.0"}}
}}''',
        "tsconfig.json": '''{"compilerOptions": {"target": "ES2020", "lib": ["dom", "dom.iterable", "esnext"], "allowJs": true, "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true, "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true, "isolatedModules": true, "jsx": "preserve", "incremental": true, "baseUrl": ".", "paths": {"@/*": ["./src/*"]}}, "include": ["**/*.ts", "**/*.tsx"], "exclude": ["node_modules"]}''',
        "tailwind.config.ts": '''import type { Config } from "tailwindcss";
const config: Config = { content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"], theme: { extend: {} }, plugins: [] };
export default config;
''',
        "next.config.js": '''/** @type {import('next').NextConfig} */
module.exports = { reactStrictMode: true };
''',
        ".env.example": '''DATABASE_URL="postgresql://user:password@localhost:5432/dbname"
SECRET_KEY="your-secret-here"  # ⚠️ SCAFFOLDING PLACEHOLDER — replace before deployment
''',
        ".gitignore": '''node_modules/
.next/
dist/
build/
.env
.env.local
__pycache__/
*.pyc
.venv/
.DS_Store
''',
        "docker-compose.yml": f'''version: "3.8"
services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: {project_name}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
volumes:
  postgres_data:
''',
        "Dockerfile": '''FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]
''',
        "README.md": f'''# {project_name}

Generated by Fullstack Project Scaffolder.

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000.
''',
        "__init__.py": "",
    }

    # Handle special cases
    if "routes" in filepath and filename == "index.ts":
        return '''import { Router } from "express";
import usersRouter from "./users";

const router = Router();
router.use("/users", usersRouter);
export default router;
'''

    if "schemas" in filepath and filename == "user.py":
        return '''from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class UserBase(BaseModel):
    email: EmailStr
    name: Optional[str] = None

class UserCreate(UserBase):
    password: str

class UserResponse(UserBase):
    id: int
    created_at: datetime
    class Config:
        from_attributes = True
'''

    if "users" in filepath and filename == "urls.py":
        return '''from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet)
urlpatterns = [path("", include(router.urls))]
'''

    return contents.get(filename, f"// {filename}\n")


def create_project(template_name: str, project_name: str, output_dir: Path) -> Dict:
    """Create project from template."""
    if template_name not in TEMPLATES:
        return {
            "success": False,
            "error": f"Unknown template: {template_name}",
            "available": list(TEMPLATES.keys())
        }

    template = TEMPLATES[template_name]
    project_dir = output_dir / project_name

    if project_dir.exists():
        return {"success": False, "error": f"Directory exists: {project_dir}"}

    created_files = []
    created_dirs = []

    for dir_path, files in template["structure"].items():
        if dir_path:
            full_dir = project_dir / dir_path
        else:
            full_dir = project_dir

        full_dir.mkdir(parents=True, exist_ok=True)
        created_dirs.append(str(full_dir))

        for filename in files:
            filepath = full_dir / filename
            filepath.parent.mkdir(parents=True, exist_ok=True)
            content = get_file_content(template_name, str(Path(dir_path) / filename), project_name)
            filepath.write_text(content)
            created_files.append(str(filepath))

    return {
        "success": True,
        "project_name": project_name,
        "template": template_name,
        "description": template["description"],
        "location": str(project_dir),
        "files_created": len(created_files),
        "directories_created": len(created_dirs),
        "next_steps": get_next_steps(template_name, project_name)
    }


def get_next_steps(template: str, name: str) -> List[str]:
    """Get setup instructions for template."""
    steps = {
        "nextjs": [f"cd {name}", "npm install", "cp .env.example .env.local", "npm run dev"],
        "fastapi-react": [
            f"cd {name}",
            "docker-compose up -d db",
            "cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload",
            "cd frontend && npm install && npm run dev"
        ],
        "mern": [
            f"cd {name}",
            "docker-compose up -d mongo",
            "cd server && npm install && npm run dev",
            "cd client && npm install && npm run dev"
        ],
        "django-react": [
            f"cd {name}",
            "docker-compose up -d db",
            "cd backend && pip install -r requirements.txt && python manage.py migrate && python manage.py runserver",
            "cd frontend && npm install && npm run dev"
        ],
        "aws-serverless-cdk": [
            f"cd {name}",
            "npm install",
            "npm test --workspace=packages/core   # fast, no AWS needed — start here",
            "cd infra/cdk && npx cdk bootstrap && npx cdk deploy",
            "cd ../../apps/web && npm run dev   # point .env at the cdk deploy output"
        ]
    }
    return steps.get(template, [f"cd {name}"])


def list_templates() -> Dict:
    """List available templates."""
    return {
        "templates": [
            {"name": k, "display_name": v["name"], "description": v["description"]}
            for k, v in TEMPLATES.items()
        ]
    }


def print_result(result: Dict, as_json: bool = False) -> None:
    """Print result."""
    if as_json:
        print(json.dumps(result, indent=2))
        return

    if "templates" in result:
        print("\nAvailable Templates:")
        print("=" * 50)
        for t in result["templates"]:
            print(f"\n  {t['name']}")
            print(f"    {t['description']}")
        return

    if not result.get("success"):
        print(f"Error: {result.get('error')}")
        return

    print("\n" + "=" * 50)
    print("Project Created Successfully")
    print("=" * 50)
    print(f"Project: {result['project_name']}")
    print(f"Template: {result['template']}")
    print(f"Location: {result['location']}")
    print(f"Files: {result['files_created']}")
    print("\nNext Steps:")
    for i, step in enumerate(result["next_steps"], 1):
        print(f"  {i}. {step}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Generate fullstack project scaffolding",
        epilog="Examples:\n  %(prog)s nextjs my-app\n  %(prog)s fastapi-react my-api\n  %(prog)s --list-templates",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("template", nargs="?", help="Project template")
    parser.add_argument("project_name", nargs="?", help="Project name")
    parser.add_argument("--output", "-o", default=".", help="Output directory")
    parser.add_argument("--list-templates", "-l", action="store_true", help="List templates")
    parser.add_argument("--json", action="store_true", help="JSON output")

    args = parser.parse_args()

    if args.list_templates:
        print_result(list_templates(), args.json)
        return

    if not args.template or not args.project_name:
        parser.print_help()
        sys.exit(1)

    result = create_project(args.template, args.project_name, Path(args.output).resolve())
    print_result(result, args.json)

    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
