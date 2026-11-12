import Link from "next/link";
import { HeroLoop } from "@/components/HeroLoop";
import { REPO_URL } from "@/lib/config";

// The first slice of a real test will (released 2026-11-05 on the hosted stack), one link per chain.
const PROOF: [string, string][] = [
  ["NEAR", "https://testnet.nearblocks.io/address/alice.inheirit-gzdcfh.testnet"],
  ["Ethereum Sepolia", "https://sepolia.etherscan.io/tx/0x0df06408e6ae91219b8c7fb45a3fefa8c8f2eff54d3e9f6b0e65fe8a16ef76ff"],
  ["Bitcoin testnet4", "https://mempool.space/testnet4/tx/50876126ed1784ed78ad41e5dbbe544031e0b0fd0ded2f36efc7f7f6fdfc4dae"],
];

const STEPS = [
  ["All good", "The agent reads the signs of life you already give off: transactions on your NEAR accounts (mainnet too) and Sepolia, the heartbeat app, Telegram. Socials are coming soon. You do nothing."],
  ["Quiet", "Quiet longer than your usual (measured from your transactions)? It checks in. Any reply ends it."],
  ["Welfare check", "Still nothing? Your guardians, friends and lawyer are asked if they've heard from you."],
  ["Guardian vote", "Guardians are asked if you've passed away. One “they're alive” stops it."],
  ["Challenge period", "Enough guardians confirm; you're alerted everywhere. Any sign of life cancels."],
  ["Released in stages", "10% first, then the longest wait: a slice leaving is the loudest alarm. Then 20/30/40% on NEAR, Ethereum and Bitcoin. A sign of life stops the rest."],
  ["Secrets last", "Sealed notes open per heir after everything is handed over, plus one more wait. A secret can't be taken back."],
];

const PROBLEMS = [
  ["Check-in fatigue", "Dead-man's switches make you prove you're alive. People forget.", "No check-ins. It reads activity you already produce."],
  ["False triggers", "A hospital stay or a lost phone shouldn't hand over your savings.", "Silence never triggers it. Guardians must agree, then a challenge period."],
  ["One chain only", "Bitcoin-only or EVM-only tools leave the rest behind.", "One will across NEAR, Ethereum and Bitcoin via Chain Signatures."],
  ["Heirs can't claim", "No wallet on the right chain, or no idea the assets exist.", "Each heir picks the asset and chain via NEAR Intents."],
  ["Secrets in public wills", "A seed phrase can't go into a will that becomes public.", "Sealed notes, opened in an enclave and re-sealed to the heir, last."],
];

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="grid items-center gap-12 pt-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-6xl">A will that doesn&apos;t make you prove you&apos;re alive.</h1>
          <p className="max-w-xl text-lg text-muted">
            It reaches out only when you&apos;ve gone quiet for longer than usual. Silence never sets it off; people do. Assets go in reversible
            slices, secrets last.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/owner" className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-ink hover:opacity-90">
              Try it in 3 minutes
            </Link>
          </div>
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-sm text-muted">
              Real on testnet: a test will&apos;s first 10%, released on three chains by an attested TDX agent.
            </p>
            <div className="tech flex flex-wrap gap-2">
              {PROOF.map(([label, href]) => (
                <a key={label} href={href} target="_blank" rel="noreferrer" className="rounded border border-line-strong px-2 py-1 hover:bg-accent-soft">
                  {label} ↗
                </a>
              ))}
            </div>
          </div>
        </div>
        <HeroLoop />
      </section>

      <section className="space-y-6">
        <h2 className="font-serif text-3xl">How it works</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-card p-5">
            <div className="tech-label">Layer 1</div>
            <div className="mt-1 font-serif text-xl">Signs of life</div>
            <p className="mt-2 text-sm text-muted">
              Signals weighted by how hard they are to fake. A transaction or heartbeat counts alone; a post needs a second source.
            </p>
          </div>
          <div className="rounded-2xl bg-card p-5">
            <div className="tech-label">Layer 2</div>
            <div className="mt-1 font-serif text-xl">Checks</div>
            <p className="mt-2 text-sm text-muted">
              After your quiet period: heartbeat app, Telegram, then people you trust. Any reply resets it.
            </p>
          </div>
        </div>
        <p className="max-w-2xl text-lg text-muted">
          <strong className="text-ink">Signals can stop it; only people can start it.</strong>
        </p>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={`rounded-2xl bg-card p-5 ${i === STEPS.length - 1 ? "sm:col-span-2 lg:col-span-3" : ""}`}>
              <div className="tech-label">Step {i + 1}</div>
              <div className="mt-1 font-serif text-xl">{title}</div>
              <p className="mt-2 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-6">
        <h2 className="font-serif text-3xl">Why earlier attempts failed</h2>
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
        {[
          ["Private by construction", "The agent runs in an attested TDX enclave; only timestamps leave it. Your will's text goes only to an attested NEAR AI Cloud model."],
          ["Staged and reversible", "Slices, not lump sums. A sign of life stops the rest; withdraw any time at All good."],
          ["Heirs get what they use", "Each slice is paid in the asset and chain the heir chose, via NEAR Intents. Optional: pay in dollars."],
          ["If Inheirit disappears", "Nothing is released. NEAR slices are paid by the contract; any newly approved agent can resume Ethereum and Bitcoin from its records."],
          ["Alongside a legal will", "It complements one, not replaces it. Your lawyer can file a death certificate to speed up (never skip) the release."],
          ["Honest about limits", "Wills run on testnet; payout quotes are live mainnet. Sources not connected yet are labelled SIMULATED."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-card p-5">
            <div className="font-serif text-xl">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-accent-soft p-6">
        <p className="tech-label">Next</p>
        <p className="mt-2 font-serif text-2xl text-accent">Next: gifts that release at milestones.</p>
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
