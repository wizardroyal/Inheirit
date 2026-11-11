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
  ["All good", "The agent quietly notices the signs of life you already give off: NEAR and Ethereum transactions, the heartbeat app, Telegram, your socials and more (socials are SIMULATED for now). You do nothing."],
  ["Quiet", "Silent for longer than usual? It checks in: a ping in the heartbeat app, a Telegram message. Any reply ends it."],
  ["Welfare check", "Still nothing? Your guardians, friends and lawyer get a friendly message asking whether they've heard from you (on Telegram if they've linked it; every message also shows in the app)."],
  ["Guardian vote", "Then it escalates: your guardians are asked whether you've passed away. A single “they're alive” stops everything."],
  ["Challenge period", "If enough guardians confirm your passing, you're alerted on every channel you've linked. Any sign of life cancels."],
  ["Released in stages", "10% first, then the longest wait, because a slice leaving your vaults is the loudest possible alarm. Then 20%, 30% and 40% across NEAR, Ethereum and Bitcoin. Any sign of life that counts stops the rest."],
  ["Secrets last", "Sealed notes open for each heir only after everything is handed over and one more waiting period has passed. A note can explain how to reach a cold or hot wallet, a bank account or anything else. A secret can't be taken back, so it goes last."],
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
    <div className="space-y-20">
      <section className="grid items-center gap-12 pt-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <h1 className="font-serif text-5xl leading-[1.05] sm:text-6xl">A will that doesn&apos;t make you prove you&apos;re alive.</h1>
          <p className="max-w-xl text-lg text-muted">
            Inheirit notices your normal signs of life privately and only reaches out once you&apos;ve gone quiet for longer than usual. Silence alone
            never sets it off: people do. Then it hands your assets on in small, reversible slices, and reveals sealed instructions to the right heir
            last.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/owner" className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-ink hover:opacity-90">
              Try it in 3 minutes
            </Link>
          </div>
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-sm text-muted">
              Real on testnet: the first 10% of a test will, released on three chains by NEAR Chain Signatures, run by an attested agent in an Intel
              TDX enclave.
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
              The agent reads many signals, each weighted by how hard it is to fake. A signed transaction or a heartbeat counts on its own; a
              social post counts only when another source agrees. So one weak signal going quiet changes nothing.
            </p>
          </div>
          <div className="rounded-2xl bg-card p-5">
            <div className="tech-label">Layer 2</div>
            <div className="mt-1 font-serif text-xl">Checks</div>
            <p className="mt-2 text-sm text-muted">
              Only when your strong signals have all gone quiet for longer than the quiet period you set does it reach out: the heartbeat app, Telegram, then the
              people you trust. Any reply sends it back to the top.
            </p>
          </div>
        </div>
        <p className="max-w-2xl text-lg text-muted">
          <strong className="text-ink">Signals can stop it; only people can start it.</strong> After the checks, it takes your guardians and a
          challenge period before anything moves, and then it moves in stages:
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
          ["Private by construction", "The agent runs in a secure enclave (Intel TDX on Phala), and its attestation is checked on-chain. Only timestamps leave it, never content. Your will's wording is read only by a private model on NEAR AI Cloud whose Intel TDX and NVIDIA GPU attestation the agent verifies."],
          ["Staged and reversible", "Releases go out in slices. Any sign of life between stages stops the rest, and you can withdraw whenever the will is at All good."],
          ["Heirs get what they use", "Each slice goes on to the asset and chain the heir chose (USDC on Base, SOL, NEAR…) through NEAR Intents. Stable-value mode pays in dollars, so a release that takes months doesn't expose heirs to price swings."],
          ["If Inheirit disappears", "Nothing is released: silence never executes. NEAR releases are paid by the contract, which anyone can move along; Ethereum and Bitcoin wait for an agent, and any newly approved agent can resume them from the contract's records. While the will is at All good you can withdraw at any time."],
          ["Alongside a legal will", "Inheirit complements a legal will; it doesn't replace one. Name your lawyer in it, and they can file a death certificate to speed up (never skip) the release."],
          ["Honest about limits", "The will runs on testnet; heirs see live mainnet quotes from NEAR Intents. Signal sources we can't connect yet are labelled SIMULATED wherever they appear."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-card p-5">
            <div className="font-serif text-xl">{t}</div>
            <p className="mt-2 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl bg-accent-soft p-6">
        <p className="tech-label">Next</p>
        <p className="mt-2 font-serif text-2xl text-accent">A will is the first use. Next: gifts that release when the people you love reach their milestones.</p>
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
