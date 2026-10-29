# Deploy runbook: TEE agent upgrade + hosted web app

The human runs these steps: they need the Phala API key and contract-owner key from the shade CLI keyring, Docker Hub and Vercel logins. Run from the repo root. Everything is testnet.

## A. Upgrade the TEE agent in place (same CVM, same app_id, same sealed-notes key)

1. **Build and push the image** (user-level `docker login` with a Read & Write token):
   ```bash
   docker build --platform linux/amd64 -t unwizarding/inheirit-agent:day4 .
   docker push unwizarding/inheirit-agent:day4
   docker inspect --format '{{index .RepoDigests 0}}' unwizarding/inheirit-agent:day4
   ```
2. **Pin the digest:** put the printed `unwizarding/inheirit-agent@sha256:…` on the `image:` line of `docker-compose.yaml`.
3. **Add the demo faucet keys to `.env`** without printing them. The pool is the demo heir's testnet keys, so released coins flow back to it:
   ```bash
   python3 -c "import json,os; k=json.load(open(os.path.expanduser('~/.config/inheirit/demo-accounts.json'))); open('.env','a').write(f\"\nDEMO_FAUCET_ETH_KEY={k['heir-eth']}\nDEMO_FAUCET_BTC_KEY={k['heir-btc']}\n\")"
   ```
   Check that `.env` has `AGENT_CONTRACT_ID=inheirit.testnet` and `DEMO_MODE=true`. Optional: `NEAR_RPC_URL=` a keyed FastNEAR URL, or a comma-separated list. FastNEAR's free tier throttles a busy agent (429); leave it empty to use the default.
4. **Ship it.** Two steps, because new env keys change `allowed_envs` (Decision log 2026-10-29):
   ```bash
   npx tsx scripts/tee-agent.ts upgrade    # new compose (image + env lines); approves its hash first
   npx tsx scripts/tee-agent.ts env        # pushes .env with the full key list; approves the resulting hash
   npx tsx scripts/tee-agent.ts status
   ```
   Approve promptly: failed registrations burn agent NEAR.
5. **Check the logs** (`https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-8090.dstack-pha-prod9.phala.network/logs/shade-agent-app?text&bare&timestamps&tail=50`) for `Agent registered` and `[faucet] demo vault faucet on`. Then:
   ```bash
   curl -s https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network/demo/faucet   # enabled: true
   curl -s https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network/api/agent-info # sealedNotes.enabled: true
   ```
   The sealed-notes key must still be `ae74cf06…` (an in-place upgrade keeps it).
6. **Retire old hashes** once the new agent is registered: `npx tsx scripts/tee-agent.ts retire 8b21f5b81921cdd229e9b03f86764d7e54a452f236e770d2014a6c245b169f2f`, plus the intermediate hash printed by step 4's `upgrade`.
7. Commit `docker-compose.yaml` and `deploy/tee-agent.json`.

## B. Host the web app on Vercel

1. Push the branch to GitHub (Vercel can import the private repo).
2. Vercel → **Add New → Project** → import `wizardroyal/Inheirit`.
   - **Root Directory:** `web` (keep "Include files outside the root directory" on; `web/` imports `../src/policy`).
   - Framework, install and build commands come from `web/vercel.json`.
   - **Environment variables:**
     - `NEXT_PUBLIC_AGENT_URL` = `https://d5b714731becca502b6bd054a5cf6ffa5ce71f61-3000.dstack-pha-prod9.phala.network`
     - `NEXT_PUBLIC_CONTRACT_ID` = `inheirit.testnet`
3. Deploy, then put the URL in the README (`<WEB_URL>`) and run Scenarios A and B on it once.

## C. During judging

- Keep the CVM running (~$0.06/h). `tee-agent.ts stop|start` pauses billing and keeps the app_id and key.
- If the logs show `NEAR RPC is rate-limiting`, set `NEAR_RPC_URL` in `.env` (keyed URL or a list) and run `npx tsx scripts/tee-agent.ts env`. The key list doesn't change, so this is a plain env update and restart.
- Demo wills are driven for `DEMO_WATCH_HOURS` (default 3 h) after creation, unless mid-execution. On a judge's page, an expired will shows "the agent isn't watching" with a button to resume.
- Keep the sponsor account funded: the agent pays gas for every will it drives.
- Faucet pool (= demo heir): on 2026-10-29 it held ~0.015 Sepolia ETH and ~210k testnet4 sats. Each demo will takes 0.002 ETH + 20,000 sats, and most of that comes back when the will executes. Top it up from public faucets if it runs low (`GET /demo/faucet` shows the addresses).
