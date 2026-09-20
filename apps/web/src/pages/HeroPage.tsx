import {
  Boxes,
  WifiOff,
  GitMerge,
  Sparkles,
  Zap,
  ArrowRight,
  ShieldCheck,
  ExternalLink,
  Radio,
  ScanLine,
  BadgeCheck,
} from "lucide-react";
import { AuthPanel } from "../components/AuthPanel";
import { ThemeToggle } from "../components/ThemeToggle";

const STEPS = [
  {
    icon: WifiOff,
    title: "Two counters go offline",
    body: 'Each keeps taking sales locally — no blocked UI, no "connection lost" dead end.',
  },
  {
    icon: GitMerge,
    title: "They reconnect, in any order",
    body: "Vector clocks and a PN-Counter CRDT merge both counters' changes into one mathematically correct state — never a silent overwrite.",
  },
  {
    icon: Sparkles,
    title: "Genuine conflicts get a human call",
    body: "Only a real same-field disagreement is ever flagged — with an AI-generated, plain-language explanation to help the human decide fast.",
  },
];

const FEATURES = [
  {
    icon: WifiOff,
    title: "Offline-first",
    body: "Full offline queueing via IndexedDB — sell, restock, and edit with zero connection.",
  },
  {
    icon: GitMerge,
    title: "Conflict-free merge",
    body: "Vector clocks + a PN-Counter CRDT guarantee a correct, non-lossy result regardless of arrival order.",
  },
  {
    icon: Zap,
    title: "Real-time sync",
    body: "WebSocket push keeps every open counter live the moment a change lands.",
  },
  {
    icon: Sparkles,
    title: "AI-assisted review",
    body: "Amazon Bedrock explains genuine conflicts in plain language — advisory only, never the decision-maker.",
  },
  {
    icon: ShieldCheck,
    title: "Real multi-tenant auth",
    body: "Cognito-backed owner/manager/counter-staff roles — every route verifies a signed token, never a client-supplied ID.",
  },
  {
    icon: ScanLine,
    title: "Barcode quick-entry",
    body: "Camera-based scan resolves an item instantly, then you explicitly choose sell or restock.",
  },
];

const STATS = [
  { value: "0", label: "sales silently lost" },
  { value: "100%", label: "orderings proven correct" },
  { value: "24/7", label: "offline-tolerant" },
];

/**
 * The app's real front door. Shown whenever there's no signed-in user
 * (App.tsx's gate) — a returning, already-authenticated visit skips
 * straight past this to CounterSelectPage instead.
 */
export function HeroPage() {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-white dark:bg-slate-950">
      {/* Ambient background: soft grid + floating gradient blobs */}
      <div className="pointer-events-none absolute inset-0 bg-grid-slate [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black,transparent)]" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[32rem] w-[32rem] -translate-x-[60%] animate-float rounded-full bg-indigo-400/20 blur-3xl dark:bg-indigo-500/10" />
      <div className="pointer-events-none absolute top-40 right-0 h-[28rem] w-[28rem] translate-x-1/3 animate-float-slow rounded-full bg-fuchsia-400/20 blur-3xl dark:bg-fuchsia-500/10" />

      <nav className="sticky top-0 z-20 border-b border-slate-200/60 bg-white/70 backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-950/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between p-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm shadow-indigo-500/30">
              <Boxes className="h-5 w-5" strokeWidth={2.25} />
            </div>
            <span className="font-display font-bold tracking-tight text-slate-900 dark:text-slate-100">StockSync</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Monolithic-Dev/stocksync"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 sm:flex"
            >
              <ExternalLink className="h-4 w-4" />
              Source
            </a>
            <ThemeToggle />
          </div>
        </div>
      </nav>

      <header className="relative mx-auto max-w-3xl px-4 pb-14 pt-14 text-center sm:pb-24 sm:pt-24">
        <p className="inline-flex animate-fade-in-up items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3.5 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300">
          <Sparkles className="h-3.5 w-3.5" />
          Offline-first inventory sync, proven with math, not hope
        </p>
        <h1 className="delay-1 mt-6 animate-fade-in-up font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 dark:text-slate-100 sm:text-6xl">
          Inventory that never{" "}
          <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent">
            loses a sale
          </span>
          {" "}— even offline.
        </h1>
        <p className="delay-2 mx-auto mt-5 max-w-xl animate-fade-in-up text-base text-slate-600 dark:text-slate-400 sm:text-lg">
          Two billing counters, one shaky connection. StockSync guarantees that when both go offline and sell the
          same item, reconnecting always converges to one correct stock count — never a silent overwrite.
        </p>
        <div className="delay-3 mt-9 flex animate-fade-in-up flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="#try-it"
            className="group flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-indigo-600 to-indigo-700 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/25 transition-all hover:-translate-y-0.5 hover:shadow-xl hover:shadow-indigo-600/30 active:translate-y-0"
          >
            Launch live demo
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </a>
          <a
            href="#how-it-works"
            className="rounded-lg border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600"
          >
            How it works
          </a>
        </div>

        <div className="delay-4 mx-auto mt-14 grid max-w-lg animate-fade-in-up grid-cols-3 gap-4 border-t border-slate-200 pt-8 dark:border-slate-800">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 sm:text-3xl">{stat.value}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            </div>
          ))}
        </div>
      </header>

      <section id="how-it-works" className="relative mx-auto max-w-4xl px-4 py-16">
        <div className="text-center">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <Radio className="h-4 w-4" />
            How it works
          </h2>
          <p className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 sm:text-3xl">
            Three steps, zero lost sales
          </p>
        </div>
        <div className="relative mt-10 grid gap-6 sm:grid-cols-3">
          <div className="absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent dark:via-slate-700 sm:block" />
          {STEPS.map((step, i) => (
            <div
              key={step.title}
              className="group relative rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg hover:shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:shadow-none"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 text-white shadow-sm shadow-indigo-500/30 transition-transform group-hover:scale-110">
                <step.icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <p className="mt-4 text-xs font-bold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Step {i + 1}</p>
              <h3 className="mt-1 font-display font-semibold text-slate-900 dark:text-slate-100">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 py-16">
        <div className="text-center">
          <h2 className="inline-flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            <BadgeCheck className="h-4 w-4" />
            Built for the hard 20%
          </h2>
          <p className="mt-2 font-display text-2xl font-bold text-slate-900 dark:text-slate-100 sm:text-3xl">
            Everything a real deployment needs
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-all hover:-translate-y-1 hover:border-indigo-200 hover:shadow-lg hover:shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-900 dark:hover:shadow-none"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 transition-colors group-hover:bg-indigo-600 group-hover:text-white dark:bg-indigo-950/60 dark:text-indigo-400">
                <feature.icon className="h-5 w-5" strokeWidth={2} />
              </div>
              <h3 className="mt-3 font-display text-sm font-semibold text-slate-900 dark:text-slate-100">{feature.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-5xl px-4 py-16">
        <AuthPanel />
      </section>

      <footer className="relative border-t border-slate-200 py-8 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Built for a hackathon demo — see the README for what's in scope and what's deliberately not.
      </footer>
    </div>
  );
}
