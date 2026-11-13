import Link from "next/link";
import type { ReactNode } from "react";
import { HeroLoop } from "@/components/HeroLoop";
import { Icon } from "@/components/icons";
import { REPO_URL } from "@/lib/config";

// The first slice of a real test will (released 2026-11-05 on the hosted stack), one link per chain.
const PROOF: [string, string][] = [
  ["NEAR", "https://testnet.nearblocks.io/address/alice.inheirit-gzdcfh.testnet"],
  ["Ethereum", "https://sepolia.etherscan.io/tx/0x0df06408e6ae91219b8c7fb45a3fefa8c8f2eff54d3e9f6b0e65fe8a16ef76ff"],
  ["Bitcoin", "https://mempool.space/testnet4/tx/50876126ed1784ed78ad41e5dbbe544031e0b0fd0ded2f36efc7f7f6fdfc4dae"],
];

const PROBLEMS = [
  ["Check-in fatigue", "Dead-man's switches make you prove you're alive. People forget.", "No check-ins. It reads activity you already produce."],
  ["False triggers", "A hospital stay or a lost phone shouldn't hand over your savings.", "Silence never triggers it. Guardians must agree, then a challenge period."],
  ["One chain only", "Bitcoin-only or EVM-only tools leave the rest behind.", "One will across NEAR, Ethereum and Bitcoin; the Ethereum and Bitcoin vaults use Chain Signatures."],
  ["Heirs can't claim", "No wallet on the right chain, or no idea the assets exist.", "Each heir picks the asset and chain they receive, via NEAR Intents."],
  ["Secrets in public wills", "A seed phrase can't go into a will that becomes public.", "Sealed notes, released last: opened in an enclave and re-sealed to each heir."],
];

const PRINCIPLES = [
  ["Private by construction", "The agent runs in an attested TDX enclave and reads only timestamps. A will written in plain English goes only to an attested NEAR AI Cloud model."],
  ["If Inheirit disappears", "The rules live in the contract: guardians still decide, NEAR slices are still paid, and a newly approved agent can resume Ethereum and Bitcoin from its records."],
  ["Alongside a legal will", "It complements a legal will; it doesn't replace one. Your lawyer can file a death certificate to shorten the waits, never to skip a step."],
  ["Honest about limits", "Wills run on testnet; payout quotes are live mainnet. Sources not connected yet are marked coming soon."],
];

const em = (s: string) => <em className="italic">{s}</em>;

/** A small dark product card with its caption underneath, for the scrolling row. */
function Shot({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <figure className="w-72 shrink-0 snap-start space-y-3 lg:w-auto">
      <div className="film-card tech h-56 rounded-2xl p-4 text-sm">{children}</div>
      <figcaption>
        <span className="block font-medium">{title}</span>
        <span className="text-sm text-muted">{text}</span>
      </figcaption>
    </figure>
  );
}

const row = "flex items-center justify-between gap-2 border-b border-[#2f2c27] py-1.5 last:border-0";

export default function Home() {
  return (
    <div className="space-y-20">
      {/* Hero: dawn sky, the pitch, and the product's one moment in a phone. */}
      <section className="sky -mx-4 overflow-hidden px-4 pt-14 sm:mx-0 sm:rounded-3xl">
        <div className="mx-auto max-w-3xl space-y-5 text-center">
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-6xl">A will that doesn&apos;t make you {em("prove")} you&apos;re alive.</h1>
          <p className="mx-auto max-w-xl text-lg opacity-80">It checks in only when you&apos;ve been quiet for longer than usual, and silence alone never releases anything: your guardians decide.</p>
          <Link href="/account" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#fffdf9] px-6 py-3 font-medium text-[#1f2320] shadow hover:opacity-90">
            Try it in 3 minutes →
          </Link>
        </div>
        <div className="mx-auto mt-10 w-full max-w-sm rounded-t-[2.5rem] border-[10px] border-b-0 border-[#151412] bg-[#151412] px-1 pt-6">
          <HeroLoop />
        </div>
      </section>

      {/* A dark band with the line that matters and the proof, like laurels. */}
      <section className="film -mx-4 space-y-6 px-6 py-14 text-center sm:mx-0 sm:rounded-3xl">
        <h2 className="font-serif text-3xl sm:text-4xl">You shouldn&apos;t have to {em("check in")} to stay alive.</h2>
        <p className="film-muted mx-auto max-w-xl">Signs of life can stop it; only people can start it. Assets go out in slices that any sign of life can halt, and secrets go last.</p>
        <div className="flex flex-wrap justify-center gap-3">
          {PROOF.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noreferrer" className="tech inline-flex min-h-11 items-center gap-2 rounded-full border border-[#3a362f] px-4 py-2 text-sm hover:bg-[#24211d]">
              ❧ First 10% on {label} ↗
            </a>
          ))}
        </div>
        <p className="film-muted text-sm">A real test will on testnet: its first slice, paid on three chains.</p>
      </section>

      {/* The product in small pieces. */}
      <section className="space-y-6">
        <h2 className="text-center font-serif text-4xl">See your {em("whole")} will.</h2>
        <div className="-mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
          <Shot title="Signs of life" text="Activity you already produce, weighted by how hard it is to fake.">
            {[
              ["Heartbeat", "strong", "● 2 min"],
              ["NEAR", "strong", "● 1 day"],
              ["Telegram", "medium", "● 3 d"],
              ["GitHub", "weak", "○"],
            ].map(([a, b, c]) => (
              <div key={a} className={row}>
                <span>{a}</span>
                <span className="text-[#a39b8e]">{b}</span>
                <span className="text-[#9fd3b8]">{c}</span>
              </div>
            ))}
          </Shot>
          <Shot title="Guardian vote" text="Only guardians who accepted count. One “they're alive” stops it.">
            <p className="text-[#a39b8e]">Guardian vote · 2 of 3 must confirm</p>
            {[
              ["Lazarus", "✓ confirmed"],
              ["Mary", "✓ confirmed"],
              ["Geti", "invited"],
            ].map(([a, b]) => (
              <div key={a} className={row}>
                <span>{a}</span>
                <span className={b.startsWith("✓") ? "text-[#9fd3b8]" : "text-[#e7c27a]"}>{b}</span>
              </div>
            ))}
          </Shot>
          <Shot title="Released in stages" text="10% first, then the longest wait: a slice leaving is the loudest alarm.">
            {[
              [10, "sent", "w-[10%]"],
              [20, "in 6 months", "w-[20%]"],
              [30, "3 months later", "w-[30%]"],
              [40, "3 months later", "w-[40%]"],
            ].map(([p, when, w]) => (
              <div key={p} className="py-1.5">
                <div className="flex justify-between">
                  <span>{p}%</span>
                  <span className="text-[#a39b8e]">{when}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-[#2f2c27]">
                  <div className={`h-1.5 rounded ${p === 10 ? "bg-[#9fd3b8]" : "bg-[#4a463f]"} ${w}`} />
                </div>
              </div>
            ))}
          </Shot>
          <Shot title="Heirs get what they use" text="Each heir picks the asset and chain they receive; NEAR Intents pays each slice in it.">
            <p className="text-[#a39b8e]">Ada chose</p>
            <p className="mt-1 font-serif text-2xl">USDC on Base</p>
            <div className={`${row} mt-4`}>
              <span>$10 of NEAR</span>
              <span className="text-[#9fd3b8]">≈ 10.01 USDC</span>
            </div>
            <p className="mt-2 text-[#a39b8e]">example; heirs see live mainnet quotes</p>
          </Shot>
        </div>
      </section>

      {/* The check-in, as it arrives. */}
      <section className="space-y-6 text-center">
        <h2 className="font-serif text-4xl">Receive {em("gentle")} check-ins.</h2>
        <div className="film mx-auto flex max-w-xl items-start gap-3 rounded-2xl p-4 text-left shadow-lg">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2a2723]">
            <Icon name="telegram" className="h-4 w-4" />
          </span>
          <span className="text-sm">
            Just checking in: we haven&apos;t seen any activity from you for a while. Reply with anything (or open the heartbeat app) and that&apos;s it, nothing else happens.
          </span>
          <span className="film-muted ml-auto text-xs">now</span>
        </div>
        <p className="text-muted">Only after the quiet period you set. A Telegram reply or opening the heartbeat app is a sign of life.</p>
      </section>

      {/* Alternating tiles: the three ideas, each next to what it looks like. */}
      <section className="grid gap-4 sm:grid-cols-2">
        <div className="tile-dusk order-1 flex min-h-64 sm:order-none flex-col justify-between rounded-3xl p-8">
          <h3 className="font-serif text-4xl">We {em("watch")} quietly</h3>
          <p className="opacity-90">It reads when you were active, never what you did, inside an attested enclave.</p>
        </div>
        <div className="film-card tech order-2 flex min-h-64 flex-col justify-center gap-3 rounded-3xl p-8 text-sm sm:order-none">
          <p className="text-[#9fd3b8]">Alive. Last strong signal: heartbeat app 2 minutes ago.</p>
          <p className="text-[#a39b8e]">Usually active every 3 days, from the last 90 days of transactions.</p>
        </div>
        <div className="film-card tech order-4 flex min-h-64 flex-col justify-center gap-2 rounded-3xl p-8 text-sm sm:order-none">
          <p className="text-[#a39b8e]">Challenge period</p>
          <p>Guardians have confirmed. You&apos;re alerted on every channel, and any sign of life cancels it. Nothing has moved yet.</p>
          <p className="text-[#e7c27a]">A lawyer&apos;s death certificate can shorten the waits, never skip one.</p>
        </div>
        <div className="tile-meadow order-3 flex min-h-64 sm:order-none flex-col justify-between rounded-3xl p-8">
          <h3 className="font-serif text-4xl">People {em("decide")}</h3>
          <p className="opacity-90">Silence alone never moves a coin. Your guardians must agree, then you get a challenge period.</p>
        </div>
        <div className="tile-clay order-5 flex min-h-64 sm:order-none flex-col justify-between rounded-3xl p-8">
          <h3 className="font-serif text-4xl">Secrets come {em("last")}</h3>
          <p className="opacity-90">Unsent slices can still be stopped; a revealed secret can&apos;t be taken back. Notes open for each heir only after everything is handed over.</p>
        </div>
        <div className="film-card tech order-6 flex min-h-64 flex-col justify-center gap-2 rounded-3xl p-8 text-sm sm:order-none">
          <p className="text-[#a39b8e]">Sealed note · for Ada</p>
          <p className="font-serif text-xl">“The Ledger is in the blue folder in the study…”</p>
          <p className="text-[#a39b8e]">Opened in the enclave and re-sealed to Ada&apos;s key, after the last slice and a final wait.</p>
        </div>
      </section>

      <section className="space-y-6">
        <h2 className="font-serif text-3xl">Why earlier attempts {em("failed")}</h2>
        <div className="overflow-x-auto rounded-2xl bg-card">
          <table className="w-full text-sm">
            <thead className="tech-label text-left">
              <tr>
                <th className="p-3">Problem</th>
                <th className="p-3">What went wrong</th>
                <th className="p-3">What Inheirit does</th>
              </tr>
            </thead>
            <tbody>
              {PROBLEMS.map(([p, wrong, fix]) => (
                <tr key={p} className="border-t border-line align-top">
                  <td className="p-3 font-medium">{p}</td>
                  <td className="p-3 text-muted">{wrong}</td>
                  <td className="p-3">{fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {PRINCIPLES.map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-card p-5">
            <div className="font-serif text-xl">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      {/* Closing call to action. */}
      <section className="tile-meadow -mx-4 space-y-5 px-6 py-16 text-center sm:mx-0 sm:rounded-3xl">
        <h2 className="font-serif text-4xl sm:text-5xl">Set your will in {em("three minutes")}.</h2>
        <p className="opacity-90">Free on testnet. A demo account needs no wallet and no sign-up.</p>
        <Link href="/account" className="inline-flex min-h-11 items-center rounded-full bg-[#fffdf9] px-6 py-3 font-medium text-[#1f2320] hover:opacity-90">
          Get started →
        </Link>
        <p className="text-sm opacity-80">Next: gifts that release at milestones.</p>
      </section>

      <p className="text-sm text-muted">
        Built on NEAR: Chain Signatures, Shade Agents (TEE), NEAR AI Cloud and NEAR Intents ·{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-accent underline">
          Code on GitHub
        </a>{" "}
        ·{" "}
        <a href={`${REPO_URL}/blob/main/docs/VERIFY.md`} target="_blank" rel="noreferrer" className="text-accent underline">
          Verify it yourself
        </a>{" "}
        ·{" "}
        <Link href="/mainnet" className="text-accent underline">
          Mainnet
        </Link>
      </p>
    </div>
  );
}
