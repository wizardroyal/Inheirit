// Mainnet proof page (CLAUDE.md §13A.2 item 3): the real NEAR Intents payouts made from our demo vault
// with scripts/mainnet-payout.ts, each approved by a person before it was sent. Read from a committed
// JSON file, so the page needs no backend.
import Link from "next/link";
import { MainnetQuote } from "@/components/MainnetQuote";
import mainnetPayouts from "@/data/mainnet-payouts.json";

type MainnetRecord = {
  at: string;
  link: string | null;
  from: { chain: string; symbol: string; amount: number; tx: string };
  to: { chain: string; symbol: string; amount: string; recipient: string; tx: string | null };
  confidentiality: string;
  vault?: string;
  status: string;
};

const CHAINS: Record<string, string> = { near: "NEAR", eth: "Ethereum", base: "Base", arb: "Arbitrum", op: "Optimism", pol: "Polygon", sol: "Solana", btc: "Bitcoin" };
const chain = (c: string) => CHAINS[c] ?? c;
const mask = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export const metadata = { title: "Inheirit on mainnet" };

export default function MainnetPage() {
  const records = (mainnetPayouts as MainnetRecord[]).slice().reverse();
  return (
    <div className="max-w-3xl space-y-8">
      <div className="space-y-3">
        <h1 className="font-serif text-5xl">On mainnet</h1>
        <p className="text-muted">
          The will itself runs on NEAR testnet, and anyone can use it there end to end. NEAR Intents has no testnet, so the last step, paying each heir in the asset and chain they chose, is priced
          here live, on mainnet.
        </p>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="font-serif text-xl">Testnet: open to everyone</div>
          <p className="mt-1 text-sm text-muted">
            Sign in, write a will, set it in motion and play every role: owner, guardians, lawyer, heir. Testnet slices are paid onward by a SIMULATED
            NEAR Intents client priced with live quotes.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-card p-4">
          <div className="font-serif text-xl">Mainnet: a showcase, not a service</div>
          <p className="mt-1 text-sm text-muted">
            Heirs see live mainnet quotes from NEAR Intents, public and confidential, when they choose how to be paid: open an heir&apos;s page and
            press &ldquo;Get live quotes&rdquo;. Real payouts go out from our demo vault on Base through a script that a person approves one
            transaction at a time, capped at $5 each{records.length ? "; they are listed below" : ""}.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-serif text-3xl">Try a live quote</h2>
        <p className="text-sm text-muted">The same quote an heir sees when choosing how to be paid, straight from NEAR Intents on mainnet.</p>
        <div className="border border-line bg-card p-4">
          <MainnetQuote />
        </div>
      </section>

      {records.length > 0 && (
      <section className="space-y-3">
        <h2 className="font-serif text-3xl">Payouts sent</h2>
        {(
          <ul className="space-y-3">
            {records.map((r) => (
              <li key={r.from.tx} className="rounded-xl border border-line bg-card p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    {r.from.amount} {r.from.symbol} on {chain(r.from.chain)} → <b>{r.to.amount}</b> {r.to.symbol} on {chain(r.to.chain)}
                  </span>
                  <span className="text-xs text-muted">{new Date(r.at).toUTCString()}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {r.confidentiality === "public" ? "Public" : `Confidential (${r.confidentiality})`} · {r.status.toLowerCase()} · to {mask(r.to.recipient)}
                  {r.link && <> · testnet slice {r.link}</>}
                </p>
                <p className="mt-2 flex flex-wrap gap-4">
                  <a className="text-accent underline" href={r.from.tx} target="_blank" rel="noreferrer">
                    Sent from the vault
                  </a>
                  {r.to.tx ? (
                    <a className="text-accent underline" href={r.to.tx} target="_blank" rel="noreferrer">
                      Received by the heir
                    </a>
                  ) : (
                    <span className="text-muted">Receiving transaction not reported</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      <section className="space-y-2 text-sm text-muted">
        <h2 className="font-serif text-3xl text-ink">Why not open mainnet to everyone?</h2>
        <p>
          The agent that would sign mainnet releases runs on the Shade Agent Framework, which is experimental and, per NEAR&apos;s own docs, testnet
          only. A public vault holding other people&apos;s money needs a production TEE framework and an audit first.
        </p>
        <p>
          <Link href="/owner" className="text-accent underline">
            Try the full will on testnet
          </Link>
        </p>
      </section>
    </div>
  );
}
