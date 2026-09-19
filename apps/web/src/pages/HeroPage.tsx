import { BoxIcon, WifiOffIcon, MergeIcon, SparklesIcon, BoltIcon, ArrowRightIcon } from "../components/icons";
import { AuthPanel } from "../components/AuthPanel";
import { ThemeToggle } from "../components/ThemeToggle";

const STEPS = [
  {
    icon: WifiOffIcon,
    title: "Two counters go offline",
    body: 'Each keeps taking sales locally — no blocked UI, no "connection lost" dead end.',
  },
  {
    icon: MergeIcon,
    title: "They reconnect, in any order",
    body: "Vector clocks and a PN-Counter CRDT merge both counters' changes into one mathematically correct state — never a silent overwrite.",
  },
  {
    icon: SparklesIcon,
    title: "Genuine conflicts get a human call",
    body: "Only a real same-field disagreement is ever flagged — with an AI-generated, plain-language explanation to help the human decide fast.",
  },
];

const FEATURES = [
  {
    icon: WifiOffIcon,
    title: "Offline-first",
    body: "Full offline queueing via IndexedDB — sell, restock, and edit with zero connection.",
  },
  {
    icon: MergeIcon,
    title: "Conflict-free merge",
    body: "Vector clocks + a PN-Counter CRDT guarantee a correct, non-lossy result regardless of arrival order.",
  },
  {
    icon: BoltIcon,
    title: "Real-time sync",
    body: "WebSocket push keeps every open counter live the moment a change lands.",
  },
  {
    icon: SparklesIcon,
    title: "AI-assisted review",
    body: "Amazon Bedrock explains genuine conflicts in plain language — advisory only, never the decision-maker.",
  },
];

/**
 * The app's real front door. Shown whenever there's no signed-in user
 * (App.tsx's gate) — a returning, already-authenticated visit skips
 * straight past this to CounterSelectPage instead.
 */
export function HeroPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-white dark:from-indigo-950/40 dark:via-slate-950 dark:to-slate-950">
      <nav className="mx-auto flex max-w-5xl items-center justify-between p-4 sm:p-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <BoxIcon className="h-5 w-5" />
          </div>
          <span className="font-bold text-slate-900 dark:text-slate-100">StockSync</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="https://github.com/Monolithic-Dev/stocksync"
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
          >
            View source ↗
          </a>
          <ThemeToggle />
        </div>
      </nav>

      <header className="mx-auto max-w-3xl px-4 pb-12 pt-8 text-center sm:pb-20 sm:pt-16">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
          <SparklesIcon className="h-3.5 w-3.5" />
          Offline-first inventory sync, proven with math, not hope
        </p>
        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl">
          Inventory that never loses a sale — even offline.
        </h1>
        <p className="mt-4 text-base text-slate-600 dark:text-slate-400 sm:text-lg">
          Two billing counters, one shaky connection. StockSync guarantees that when both go offline and sell the
          same item, reconnecting always converges to one correct stock count — never a silent overwrite.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#try-it"
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700"
          >
            Launch live demo <ArrowRightIcon className="h-4 w-4" />
          </a>
          <a
            href="#how-it-works"
            className="rounded-md border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            How it works
          </a>
        </div>
      </header>

      <section id="how-it-works" className="mx-auto max-w-4xl px-4 py-12">
        <h2 className="text-center text-sm font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">How it works</h2>
        <div className="mt-6 grid gap-6 sm:grid-cols-3">
          {STEPS.map((step, i) => (
            <div key={step.title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-400">
                <step.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-xs font-semibold text-slate-400 dark:text-slate-500">Step {i + 1}</p>
              <h3 className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{step.title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <feature.icon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <h3 className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{feature.title}</h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <AuthPanel />
      </section>

      <footer className="border-t border-slate-100 py-8 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Built for a hackathon demo — see the README for what's in scope and what's deliberately not.
      </footer>
    </div>
  );
}
