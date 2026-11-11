# Deploy runbook: TEE agent upgrade + hosted web app

The full history and the reasoning behind each step are in `CLAUDE.md` (§14 Status, Decision log). Scripts need `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"` on this WSL machine.

## A. Upgrade the TEE agent in place (same CVM, same app_id, same sealed-notes key)

Never create a new CVM: a new app_id means a new sealed-notes key and every existing note is stranded (§7.5).

1. Build and push the image, then pin its digest:
   ```bash
   docker build --platform linux/amd64 -t unwizarding/inheirit-agent:<tag> .
   docker push unwizarding/inheirit-agent:<tag>      # prints the digest
   ```
   Put `unwizarding/inheirit-agent@sha256:<digest>` on the `image:` line of `docker-compose.yaml`.
2. Make sure the shade CLI keyring has both credentials: `npx tsx scripts/tee-agent.ts status` must work. (On WSL the kernel keyring is wiped on every restart; restore it from `.env`.)
3. The CVM must be running (`tee-agent.ts start` if not), and the TEE sponsor (`TEE_SPONSOR_*` in `.env`) must hold ≥ 1.5 NEAR: every reboot funds a new agent account with 0.5.
4. `npx tsx scripts/tee-agent.ts upgrade`: approves the new compose hash *before* committing, then the CVM reboots (~70 s).
5. Only if `ENV_KEYS` in `scripts/tee-agent.ts` gained a key: `tee-agent.ts env` (retry while it says "Another operation is already in progress"), wait ~45 s, then `tee-agent.ts approve` at once (the env update changes the compose hash).
6. Check registration: `tee-agent.ts status` shows the new agent account with the new compose hash and `"Valid"`; `GET <agent>/api/agent-info` shows the same sealed-notes key (`ae74cf06…`) and `enabled: true`.
7. Retire the previous hash (one per call): `tee-agent.ts retire <old compose hash>`. Record the new one in `deploy/tee-agent.json`.

## B. Host the web app on Vercel

1. Vercel project: Root Directory `web`, branch `main`. Install command comes from `web/vercel.json`.
2. Environment variables (Production):
   - `NEXT_PUBLIC_AGENT_URL` = `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network`
   - `NEXT_PUBLIC_CONTRACT_ID` = `inheirit.testnet`
   - `ONBOARD_PARENT_ACCOUNT`, `ONBOARD_PARENT_KEY`: the account that funds sign-ups (`inheirit-users.testnet`; never `inheirit.testnet`)
   - `GOOGLE_CLIENT_ID`: for Google sign-in
   - `ONECLICK_JWT`: the NEAR Intents partner key, for confidential live quotes
   - optional limits: `ONBOARD_FUND_NEAR` (1.5), `ONBOARD_HOURLY_NEAR` (80, per instance), `ONBOARD_IP_HOURLY_NEAR` (6, per network), `ONBOARD_PARENT_FLOOR_NEAR` (3); `NEXT_PUBLIC_X_POST_URL` once the demo post exists
3. Before saying a deploy works, build from a clean clone the way Vercel does: `git clone` → `cd web` → `npx -y npm@10.9.2 ci --prefix .. --ignore-scripts && npx -y npm@10.9.2 ci && npx next build`.
4. Don't script requests at the hosted site (it once triggered Vercel's DDoS challenge); test with a local `next dev` pointed at the hosted backend.

## C. Contract code upgrades (storage layout unchanged)

Build with the pinned image (`sourcescan/cargo-near@sha256:772638e3…`, see §14 Commands), run `cargo +1.86.0 test --tests`, then `npx tsx scripts/upgrade-contract-code.ts inheirit-dev2.testnet` and `… inheirit.testnet`. The script checks the on-chain code hash and that the contract still reads.

## D. During judging

- Keep the CVM running (Phala credit ≈ $0.06/h) and the TEE sponsor ≥ 1.5 NEAR. The agent tops itself up from the sponsor at most 4 × 0.5 NEAR a day.
- Keep `inheirit-users.testnet` funded (1.5 NEAR per demo or Google sign-in); refill with `scripts/new-onboard-parent.ts inheirit-users.testnet <n> --topup`.
- Speedrun wills (quiet after < 1 h) stop being watched `DEMO_WATCH_HOURS` (default 3) after they started, but never mid-release, in the guardian vote or in the challenge period. Wills on real timings are watched indefinitely. Changing timings or Start over makes the agent watch again.
- Hosted regression: `scripts/demo-cancel.ts` (Scenario A, ~5 min).
