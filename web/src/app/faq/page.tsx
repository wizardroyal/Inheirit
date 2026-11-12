// Short answers to the questions people ask first.
const QA: [string, string[]][] = [
  [
    "What if Inheirit disappears?",
    [
      "Nothing is released: silence alone never sets the will off, and without people confirming, nothing moves.",
      "The will lives in a NEAR contract, not on our servers. NEAR slices are paid by the contract itself, and anyone can call it to move a will along. Ethereum and Bitcoin need an approved agent to sign; a new approved agent can pick up from the contract's records.",
      "While your will is at All good you can withdraw or close it at any time.",
    ],
  ],
  [
    "What's on-chain, and what needs the agent?",
    [
      "On-chain (NEAR contract): the will, the guardians and their votes, the challenge period, the staged schedule, the NEAR vault and its payouts, the encrypted secrets, and who may ask for signatures.",
      "The agent (in an attested enclave): reading signs of life (times only), sending checks by email and Telegram, signing Ethereum and Bitcoin payouts through Chain Signatures, and re-sealing each secret to its heir at the end.",
      "The agent can only act when the contract allows it: it can't start a will or skip a step.",
    ],
  ],
  [
    "Why testnet?",
    [
      "The enclave framework we build on is experimental and not yet cleared for real money, and the contract hasn't had a professional audit. Holding strangers' savings before that would be irresponsible.",
      "So everything you try here uses test coins that have no value. The NEAR Intents payouts were shown on mainnet with a few dollars from our own demo vault.",
    ],
  ],
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-serif text-4xl">Questions</h1>
      {QA.map(([q, a]) => (
        <section key={q} className="space-y-3">
          <h2 className="font-serif text-2xl">{q}</h2>
          {a.map((p) => (
            <p key={p} className="text-lg leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
