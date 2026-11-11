import Link from "next/link";
import { HeroLoop } from "@/components/HeroLoop";
import { REPO_URL } from "@/lib/config";

const STEPS = [
  ["All good", "The agent quietly notices the signs of life you already give off: NEAR and Ethereum transactions, the heartbeat app, Telegram, GitHub. You do nothing."],
  ["Quiet", "Silent for longer than usual? It checks in: a ping in the heartbeat app, a Telegram message. Any reply ends it."],
  ["Welfare check", "Still nothing? Your guardians, friends and lawyer are asked whether they've heard from you."],
  ["Guardian vote", "Your guardians are asked whether you've passed away. A single “they're alive” stops everything."],
  ["Challenge period", "Once enough guardians agree, you're alerted on every channel. Any sign of life cancels."],
  ["Released in stages", "10% first, then the longest wait, because a slice leaving your vaults is the loudest possible alarm. Then 20%, 30%, 40% across NEAR, Ethereum and Bitcoin. Coming back stops the rest."],
  ["Secrets last", "Sealed notes open for each heir only after everything is handed over and one more wait has passed. A secret can't be taken back, so it goes last."],
];

const PROBLEMS = [
  ["Check-in fatigue", "Dead-man's switches make you prove you're alive. People forget.", "No routine check-ins. It notices activity you already produce, and asks only once you've gone quiet."],
  ["False triggers", "A hospital stay or a lost phone shouldn't hand over your savings.", "Silence alone never triggers anything. It takes enough guardians agreeing, then a challenge period."],
  ["One chain only", "Bitcoin-only or EVM-only tools leave the rest behind.", "One will across NEAR, Ethereum and Bitcoin via Chain Signatures."],
  ["Heirs can't claim", "Heirs don't have a wallet on the right chain, or don't know the assets exist.", "Each heir picks the asset and chain they're paid in (USDC on Base, SOL, NEAR…) via NEAR Intents, with a guided claim page."],
  ["Secrets in public wills", "A seed phrase can't go into a will that becomes public.", "Sealed notes, opened only inside a secure enclave and re-sealed to the right heir, last."],
];

export default function Home() {
  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <p className="inline-block bg-ink px-2 py-1 font-mono text-[11px] uppercase tracking-widest text-bg">A crypto will · NEAR · Ethereum · Bitcoin</p>
          <h1 className="font-serif text-5xl sm:text-7xl">A will that doesn&apos;t make you prove you&apos;re alive.</h1>
          <p className="max-w-xl text-lg">
            Inheirit notices your normal signs of life privately and only reaches out once you&apos;ve gone quiet for longer than usual. Silence alone
            never sets it off: people do. Then it hands your assets on in small, reversible slices, and reveals sealed instructions to the right heir
            last.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/owner" className="border border-line bg-accent px-6 py-3 font-mono text-sm font-bold uppercase tracking-wider text-accent-ink">
              Try it in 3 minutes →
            </Link>
            <span className="font-mono text-xs uppercase tracking-wider text-muted">No sign-up · testnet · nothing costs money</span>
          </div>
          <p className="max-w-xl text-sm text-muted">
            Click <b className="text-ink">Try with a demo account</b>, then <b className="text-ink">Generate a sample will for me</b>, then go quiet
            and watch the ladder climb, and send one sign of life to snap it back. The full run, all the way to an heir opening a sealed note, takes
            about 15 minutes.{" "}
            <Link href="/demo" className="text-accent underline">
              Advanced: the raw control panel
            </Link>
            .
          </p>
        </div>
        <HeroLoop />
      </section>

      <section className="space-y-5">
        <h2 className="font-serif text-4xl">How it works</h2>
        <p className="max-w-2xl text-lg">
          Two rules: <strong className="bg-accent-soft px-1">signals can stop it; only people can start it.</strong> Any sign of life sends the will
          back to the top. Moving down the ladder takes time first, then people.
        </p>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={`border border-line bg-card p-4 ${i === STEPS.length - 1 ? "sm:col-span-2 lg:col-span-3" : ""}`}>
              <div className="font-mono text-3xl font-bold text-accent">{String(i + 1).padStart(2, "0")}</div>
              <div className="mt-1 font-serif text-xl">{title}</div>
              <p className="mt-2 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-5">
        <h2 className="font-serif text-4xl">Why earlier attempts failed</h2>
        <div className="overflow-x-auto border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="bg-ink text-left font-mono text-[11px] uppercase tracking-wider text-bg">
              <tr>
                <th className="p-3">Problem</th>
                <th className="p-3">What went wrong</th>
                <th className="p-3">What Inheirit does</th>
              </tr>
            </thead>
            <tbody>
              {PROBLEMS.map(([p, wrong, fix]) => (
                <tr key={p} className="border-t-2 border-line align-top">
                  <td className="p-3 font-serif">{p}</td>
                  <td className="p-3 text-muted">{wrong}</td>
                  <td className="p-3">{fix}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-5 sm:grid-cols-2">
        {[
          ["Private by construction", "The agent runs in a secure enclave (Intel TDX on Phala), and its attestation is checked on-chain. Only timestamps leave it, never content. Your will's wording is read only by a private model on NEAR AI Cloud whose Intel TDX and NVIDIA GPU attestation the agent verifies."],
          ["Staged and reversible", "Releases go out in slices. Any sign of life between stages stops the rest, and you can withdraw at any time while you're alive."],
          ["Heirs get what they use", "Each slice goes on to the asset and chain the heir chose (USDC on Base, SOL, NEAR…) through NEAR Intents. Stable-value mode pays in dollars, so a release that takes months doesn't expose heirs to price swings."],
          ["Honest about limits", "The will runs on testnet; heirs see live mainnet quotes from NEAR Intents. Signal sources we can't connect yet are labelled SIMULATED wherever they appear."],
        ].map(([t, d]) => (
          <div key={t} className="border border-line bg-card p-5">
            <div className="font-serif text-xl">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="border border-line bg-ink p-6 text-bg">
        <p className="font-mono text-[11px] uppercase tracking-widest opacity-75">Next</p>
        <p className="mt-2 font-serif text-2xl">A will is the first use. Next: gifts that release when the people you love reach their milestones.</p>
      </section>

      <p className="font-mono text-xs uppercase tracking-wider text-muted">
        Built at NEAR HACKATHON on Chain Signatures, Shade Agents (TEE), NEAR AI Cloud and NEAR Intents ·{" "}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-accent underline">
          Code on GitHub
        </a>{" "}
        ·{" "}
        <Link href="/mainnet" className="text-accent underline">
          Mainnet
        </Link>
      </p>
    </div>
  );
}
