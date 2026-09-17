import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { x as extractTar } from "tar";
import { ResourceInUseException } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * Manages a real, local AWS DynamoDB Local instance (the official Java
 * emulator, not a reimplementation) for tests that need TransactWriteItems
 * — `dynalite` (used by writeIntake.test.ts and wsPush.test.ts, which
 * don't touch transactions) doesn't implement the Transact* API at all.
 *
 * Cached under ~/.cache so CI can persist it across runs (see
 * .github/workflows/ci.yml) instead of re-downloading ~55MB every time.
 */
const DOWNLOAD_URL = "https://s3.us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_latest.tar.gz";
const INSTALL_DIR = path.join(os.homedir(), ".cache", "stocksync-dynamodb-local");
const JAR_PATH = path.join(INSTALL_DIR, "DynamoDBLocal.jar");
const LIB_PATH = path.join(INSTALL_DIR, "DynamoDBLocal_lib");

async function ensureInstalled(): Promise<void> {
  if (existsSync(JAR_PATH)) return;
  mkdirSync(INSTALL_DIR, { recursive: true });
  const archivePath = path.join(INSTALL_DIR, "dynamodb-local.tar.gz");
  execSync(`curl -fsSL -o "${archivePath}" "${DOWNLOAD_URL}"`, { stdio: "inherit" });
  // Extracting via the `tar` npm package (not a shelled-out `tar` binary):
  // Windows has two incompatible `tar`s on PATH (Git's GNU tar and the
  // System32 bsdtar), and both failed here in different, PATH-order- and
  // MSYS-runtime-dependent ways when invoked outside a real MSYS shell —
  // not worth chasing further when a well-known, cross-platform library
  // (the same one npm itself uses) sidesteps the whole class of issue.
  await extractTar({ file: archivePath, cwd: INSTALL_DIR });
}

async function isReachable(port: number): Promise<boolean> {
  try {
    // Any HTTP response (even the expected 400 for an unsigned request)
    // means something is already accepting connections on this port.
    await fetch(`http://localhost:${port}/`, { method: "POST" });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(port: number, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isReachable(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`DynamoDB Local did not become ready on port ${port} within ${timeoutMs}ms`);
}

export interface DynamoDbLocalHandle {
  stop(): Promise<void>;
}

export async function startDynamoDbLocal(port: number): Promise<DynamoDbLocalHandle> {
  // If a prior run's instance is somehow still up on this port (imperfect
  // cleanup, a crashed test process), reuse it instead of piling on a
  // second JVM — the in-memory instance is harmless to share since these
  // tests isolate their own data by random item IDs / idempotency keys.
  // A handle we didn't spawn is not ours to kill.
  if (await isReachable(port)) {
    return { stop: async () => {} };
  }

  await ensureInstalled();

  const child: ChildProcess = spawn(
    "java",
    [`-Djava.library.path=${LIB_PATH}`, "-jar", JAR_PATH, "-inMemory", "-port", String(port)],
    { stdio: "ignore" },
  );

  await waitUntilReady(port);

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        const pid = child.pid;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        child.once("exit", finish);
        // Plain child.kill() has proven unreliable for actually
        // terminating the JVM on Windows in this harness (orphaned
        // DynamoDBLocal processes survived it, then collided with the
        // next test run's CreateTable calls). taskkill /T /F forcibly
        // kills the whole process tree and is the reliable fallback.
        child.kill("SIGKILL");
        if (process.platform === "win32" && pid !== undefined) {
          try {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
          } catch {
            // Already gone — fine.
          }
        }
        // Last-resort safety net so a stuck 'exit' event never hangs the
        // test suite's teardown.
        setTimeout(finish, 5000);
      }),
  };
}

// Known limitation: on Windows, this JVM child process has occasionally
// survived even the taskkill fallback above during local interactive test
// runs — the "reuse if already reachable" check in startDynamoDbLocal is
// what actually prevents that from compounding into a pile of orphaned
// instances across repeated runs, not this teardown. Doesn't affect CI:
// each GitHub Actions job is a fresh, ephemeral VM with no cross-run
// process state to leak.

/**
 * Defense in depth alongside the hardened `stop()` above: if a prior
 * run's instance somehow survives (an orphaned process on the same
 * port), table creation shouldn't fail the whole suite — it's an
 * in-memory instance, so a stale reused one is harmless for these tests,
 * which isolate their own data by random item IDs / idempotency keys.
 */
export async function createTableIfNotExists(
  ddb: DynamoDBDocumentClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  command: any,
): Promise<void> {
  try {
    await ddb.send(command);
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) throw error;
  }
}
