# Security reviews and what they changed

Every review was done by a fresh reviewer with no part in writing the code, given the spec and the code and asked to break it. Every finding was checked in the code before it was fixed, and each security fix has a test. The full record, with evidence, is in [`CLAUDE.md`](../CLAUDE.md) (Decision log). The threat model is [`THREAT_MODEL.md`](THREAT_MODEL.md).

| When | Severity | Finding | Fix | Where |
|---|---|---|---|---|
| 2026-11-05 | High | A sign of life seen during the challenge period but recorded after someone else started the release only moved the clock; the release went on | Any newer sign of life returns every pre-Completed state to Active | `agent-contract/src/will/agent.rs` (`record_liveness`) |
| 2026-11-06 | High | The contract's only full-access key was inside the TEE as the agent's sponsor | A separate sponsor with no key on the contract; the deploy tool refuses a contract key | `scripts/tee-agent.ts` |
| 2026-11-06 | High | A stranger could block the last Bitcoin stage forever with many tiny UTXOs (16-signature cap) | At most 8 inputs per tx, dust skipped, each signature saved as it arrives | `src/chains/btc.ts`, `src/executor/` |
| 2026-11-06 | High | Unsigned agent routes let anyone point a will at a busy address or post a simulated signal and keep it alive forever | Every write route needs an owner-signed NEP-413 message | `src/api.ts`, `src/auth/nep413.ts` |
| 2026-11-06 | Medium | A full record list could freeze a will mid-release; stale pending txs retried forever; owner withdrawals from ETH/BTC never sent | Caps per round, dead-tx detection, withdrawals sent by the agent | contract `will/`, `src/executor/` |
| 2026-11-10 | Medium | Start over refunded storage the contract had paid for, so an owner could slowly drain the contract | A replace never refunds below the old storage use | `agent-contract/src/will/owner.rs` |
| 2026-11-10 | Medium | Onboarding could be farmed until the sign-up fund was empty | Per-network and per-instance budgets, one top-up per account, none for our own accounts | `web/src/app/api/onboard/route.ts` |
| 2026-11-10 | Low | A leaked Google sign-in token could claim someone's account with another key | The token's nonce must be the hash of the submitted public key | `web/src/app/api/onboard/route.ts`, `web/src/components/SignIn.tsx` |
| 2026-11-11 | **Critical** | Anyone could copy a sealed note's public ciphertext into a throwaway will, rush it to "secrets released" and have the agent re-seal the plaintext to them | Notes are sealed together with their owner and heir; the agent re-seals only inside that will, to that heir | `src/sealed/crypto.ts` (`bindNote`, `reseal`), `test/sealed.test.ts` |
| 2026-11-11 | High | Heartbeats and Telegram replies made the agent pay for a transaction each, so anyone could drain its gas | Records in Active only when they matter, per-will daily caps, a gas watchdog, Telegram caps | `src/escalation/driver.ts`, `src/index.ts`, `src/telegram/bot.ts` |
| 2026-11-11 | High | Wills set to cycle the ladder every second burned the agent's gas | Contract minimum of 20 s per timing; a daily budget of new laps per will, refunded when an advance fails | `agent-contract/src/will/mod.rs`, `src/escalation/driver.ts` |
| 2026-11-11 | Medium | A will could name NEAR accounts that don't exist yet; whoever registered the name later would count as a guardian or receive the money | Every named account must exist before the will is created | `web/src/lib/demo.ts` |
| 2026-11-11 | Medium | Made-up keys and owner names cost the agent RPC calls without limit | Lookups capped per account, missing keys cached, vault reads only for existing wills | `src/auth/nep413.ts`, `src/api.ts` |

Also found and fixed across the reviews: a will getting stuck after a failed setup step, the heir page offering condolences after an owner came back, a regex that blanked the page on older Safari, README claims that had drifted from the code, and accessibility gaps (labels, contrast, focus, screen-reader text).

**Accepted, with reasons** (in the Decision log): earlier rounds' onward payouts are mapped through the current will's addresses; a failed NEAR transfer is re-split across heirs; per-IP limits at the agent aren't possible behind the enclave's gateway. All low impact, and all on testnet.
