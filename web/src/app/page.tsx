import Link from "next/link";

const STEPS = [
  ["All good", "The agent quietly watches normal signs of life: your NEAR and Ethereum transactions, the heartbeat app, GitHub. You do nothing."],
  ["Quiet", "If everything goes silent for longer than usual, you get a gentle nudge. Any activity ends it."],
  ["Welfare check", "Still nothing? People you trust are asked whether they've heard from you."],
  ["Guardian vote", "Your guardians are asked to confirm, with evidence. One “they're alive” stops it."],
  ["Challenge period", "Once enough guardians agree, you're told on every channel. Any sign of life cancels."],
  ["Released in stages", "10% first, then the longest wait, because a slice leaving your vaults is the loudest alarm. Then 20%, 30%, 40% on NEAR, Ethereum and Bitcoin. Coming back halts the rest."],
  ["Secrets last", "Sealed notes are opened for each heir only after everything is distributed and a buffer has passed. A secret can't be un-revealed, so it waits longest."],
];

const PROBLEMS = [
  ["Check-in fatigue", "Dead-man's switches make you prove you're alive. People forget.", "No check-ins. Passive signals only."],
  ["False triggers", "A hospital stay or a lost phone shouldn't hand over your savings.", "Silence alone never triggers. Only a guardian quorum plus a challenge period can."],
  ["One chain only", "Bitcoin-only or EVM-only tools leave the rest behind.", "One will across NEAR, Ethereum and Bitcoin via Chain Signatures."],
  ["Heirs can't claim", "Heirs don't have a wallet on the right chain, or don't know the assets exist.", "Each heir picks the asset and chain they're paid in (USDC on Base, SOL, NEAR…) via NEAR Intents, with a guided claim page."],
  ["Secrets in public wills", "A seed phrase can't go into a will that becomes public.", "Sealed notes, decrypted inside a TEE, re-sealed only to the right heir."],
];

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="space-y-5 pt-6">
        <h1 className="max-w-3xl font-serif text-4xl leading-tight sm:text-5xl">A will that doesn&apos;t make you prove you&apos;re alive.</h1>
        <p className="max-w-2xl text-lg text-muted">
          Inheirit reads your normal signs of life privately and only reaches out once you&apos;ve gone quiet for longer than usual. It never acts on
          silence alone. It hands over assets across NEAR, Ethereum and Bitcoin in small, reversible slices, and reveals sealed instructions to the
          right heir last.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/demo" className="rounded-lg bg-accent px-5 py-2.5 font-medium text-accent-ink hover:opacity-90">
            Try the demo
          </Link>
          <Link href="/owner" className="rounded-lg border border-line bg-card px-5 py-2.5 font-medium hover:bg-accent-soft">
            Write a will
          </Link>
        </div>
        <p className="text-sm text-muted">Runs on NEAR testnet, Ethereum Sepolia and Bitcoin testnet4. Nothing here costs real money.</p>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl">How it works</h2>
        <p className="max-w-2xl text-muted">
          Two rules: <strong className="text-ink">signals can stop it; only people can start it.</strong> Any sign of life sends the will back to the
          top. Moving down the ladder needs time, then people.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className={`rounded-xl border border-line bg-card p-4 ${i === STEPS.length - 1 ? "sm:col-span-2 lg:col-span-3" : ""}`}>
              <div className="text-xs text-muted">Step {i + 1}</div>
              <div className="font-serif text-lg">{title}</div>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="font-serif text-2xl">Why earlier attempts failed</h2>
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
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
          ["Private by construction", "The liveness agent runs in a TEE (Intel TDX on Phala). Only timestamps leave it, never content. Will text is read only by an attested private model on NEAR AI Cloud."],
          ["Staged and reversible", "Releases go out in slices. Any sign of life between stages halts the rest, and you can always withdraw while you're alive."],
          ["Heirs get what they use", "Each released slice goes on to the asset and chain the heir chose, through NEAR Intents. Stable-value mode pays in dollars so heirs aren't exposed to price swings during a release that takes months."],
          ["Honest about limits", "Testnet only. Some signal sources are simulated and labelled SIMULATED wherever they appear."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-line bg-card p-4">
            <div className="font-serif text-lg">{t}</div>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>

      <p className="text-sm text-muted">
        Built on NEAR at NEAR HACKATHON: Chain Signatures, Shade Agents (TEE), NEAR AI Cloud and NEAR Intents.
      </p>
    </div>
  );
}
