import Link from "next/link";
import type { ReactNode } from "react";
import { Carousel } from "@/components/Carousel";
import { HeroLoop } from "@/components/HeroLoop";
import { Icon } from "@/components/icons";
import { MAINNET_STORY } from "@/lib/config";

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
  ["Testnet and mainnet", MAINNET_STORY],
];

const em = (s: string) => <em className="italic">{s}</em>;

/** A small dark product card with its caption underneath, for the scrolling row. */
function Shot({ step, title, text, children }: { step: string; title: string; text: string; children: ReactNode }) {
  return (
    <figure className="w-72 shrink-0 snap-start space-y-3">
      <div className="film-card tech h-60 rounded-2xl p-4 text-sm">{children}</div>
      <figcaption>
        <span className="block font-medium">
          <span className="text-muted">{step} · </span>
          {title}
        </span>
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

      {/* How a will executes, step by step, with sample people. */}
      <section className="space-y-6">
        <h2 className="text-center font-serif text-4xl">How your will {em("executes")}</h2>
        <Carousel label="How your will executes">
          <Shot step="1" title="Signals" text="Activity you already produce, read as times only. No check-ins.">
            {[
              ["Heartbeat app", "strong"],
              ["On-chain transactions", "strong"],
              ["Email", "medium"],
              ["Telegram replies", "medium"],
              ["Calendar", "medium"],
              ["Socials", "weak"],
            ].map(([a, b]) => (
              <div key={a} className={row}>
                <span>{a}</span>
                <span className="text-[#a39b8e]">{b}</span>
              </div>
            ))}
          </Shot>
          <Shot step="2" title="Friends" text="A friendly inquiry to your chosen friends about your welfare. Any positive sign is enough.">
            <p className="text-[#a39b8e]">Have you heard from Sam recently?</p>
            {[
              ["Amara", "asked"],
              ["Tom", "asked"],
              ["Priya", "asked"],
            ].map(([a, b]) => (
              <div key={a} className={row}>
                <span>{a}</span>
                <span className="text-[#a39b8e]">{b}</span>
              </div>
            ))}
          </Shot>
          <Shot step="3" title="Guardians" text="After a long silence, guardians are alerted and vote. A single “they're alive” is enough to pause the will.">
            <p className="text-[#a39b8e]">2 of 3 must confirm</p>
            {[
              ["Daniel", "accepted"],
              ["Grace", "accepted"],
              ["Kofi", "invited"],
            ].map(([a, b]) => (
              <div key={a} className={row}>
                <span>{a}</span>
                <span className={b === "accepted" ? "text-[#9fd3b8]" : "text-[#e7c27a]"}>{b}</span>
              </div>
            ))}
          </Shot>
          <Shot step="4" title="Staged release" text="6 months after the first slice, then 3 months between the rest. Any sign of life stops the rest.">
            {[
              [10, "first slice", "w-[10%]"],
              [20, "6 months after the first", "w-[20%]"],
              [30, "3 months later", "w-[30%]"],
              [40, "3 months later", "w-[40%]"],
            ].map(([p, when, w]) => (
              <div key={p} className="py-1">
                <div className="flex justify-between gap-2">
                  <span>{p}%</span>
                  <span className="text-[#a39b8e]">{when}</span>
                </div>
                <div className="mt-1 h-1.5 rounded bg-[#2f2c27]">
                  <div className={`h-1.5 rounded bg-[#9fd3b8] ${w}`} />
                </div>
              </div>
            ))}
          </Shot>
          <Shot step="5" title="Sealed notes" text="Final secrets for your heirs, released last: directions to wallets, physical assets and more.">
            {[
              ["for Ada", "Where the hardware wallet is"],
              ["for Ben", "The house deed: blue folder in the study"],
            ].map(([who, t]) => (
              <div key={t} className="border-b border-[#2f2c27] py-2 last:border-0">
                <span className="block text-[#a39b8e]">🔒 {who}</span>
                <span>{t}</span>
              </div>
            ))}
          </Shot>
        </Carousel>
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
      </section>

    </div>
  );
}
