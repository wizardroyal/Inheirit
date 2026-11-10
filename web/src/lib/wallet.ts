"use client";
// NEAR wallets through NEAR Wallet Selector (CLAUDE.md §13A.1). The wallet keeps the keys: this module
// only asks it to sign. `call` and `signRequest` in ./near fall back to the wallet for an account this
// browser holds no key for, so pages don't need to know which kind of signer they have.
import type { NetworkId, WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { actionCreators } from "@near-js/transactions";
import { Buffer } from "buffer";
import { CONTRACT_ID } from "./config";

const STORE = "inheirit:wallet-account";
let selectorP: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;

/** The account signed in through a wallet, if any (read synchronously from what the last session saw). */
export function walletAccountId(): string | null {
  try {
    return window.localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

function setWalletAccount(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORE, id);
    else window.localStorage.removeItem(STORE);
  } catch {
    // storage blocked: the wallet still works for this page view
  }
  window.dispatchEvent(new Event("inheirit-keys"));
}

async function selector(): Promise<WalletSelector> {
  if (!selectorP) {
    selectorP = (async () => {
      // MyNearWallet uses Buffer at runtime; browsers don't have it.
      (globalThis as { Buffer?: unknown }).Buffer ??= Buffer;
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }, { setupMeteorWallet }, { setupIntearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/intear-wallet"),
      ]);
      const s = await setupWalletSelector({
        network: "testnet" as NetworkId,
        modules: [setupMyNearWallet(), setupMeteorWallet(), setupIntearWallet()],
      });
      // No contractId: every call is confirmed in the wallet, and no function-call key is left behind.
      modal = setupModal(s, { description: "Sign in with a NEAR testnet wallet. Testnet only: no real money." });
      s.store.observable.subscribe((state) => setWalletAccount(state.accounts.find((a) => a.active)?.accountId ?? null));
      return s;
    })();
  }
  return selectorP;
}

/** Opens the wallet picker; resolves once an account is signed in (or rejects if the picker is closed). */
export async function connectWallet(): Promise<string> {
  const s = await selector();
  const existing = s.store.getState().accounts.find((a) => a.active)?.accountId;
  if (existing) return existing;
  modal!.show();
  return new Promise((resolve, reject) => {
    const sub = s.store.observable.subscribe((state) => {
      const id = state.accounts.find((a) => a.active)?.accountId;
      if (id) {
        sub.unsubscribe();
        modal!.hide();
        resolve(id);
      }
    });
    modal!.on("onHide", ({ hideReason }) => {
      if (hideReason === "user-triggered" && !s.store.getState().accounts.length) {
        sub.unsubscribe();
        reject(new Error("Wallet sign-in was cancelled"));
      }
    });
  });
}

export async function disconnectWallet(): Promise<void> {
  const s = await selector();
  if (s.isSignedIn()) await (await s.wallet()).signOut();
  setWalletAccount(null);
}

async function activeWallet(accountId: string) {
  const s = await selector();
  const active = s.store.getState().accounts.find((a) => a.active)?.accountId;
  if (active !== accountId) throw new Error(`Sign in to your wallet as ${accountId} first`);
  return s.wallet();
}

export interface WalletCall {
  methodName: string;
  args: Record<string, unknown>;
  deposit: bigint;
  gas: bigint;
}

/** One transaction to the will contract with one or more function calls (one wallet approval). */
export async function walletCall(accountId: string, calls: WalletCall[]) {
  const wallet = await activeWallet(accountId);
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: CONTRACT_ID,
    actions: calls.map((c) => actionCreators.functionCall(c.methodName, c.args, c.gas, c.deposit)),
  });
  if (!outcome) throw new Error("The wallet did not return a transaction result");
  return outcome;
}

/** Creates funded subaccounts of the wallet's account, one transaction each, in one wallet approval. */
export async function walletCreateSubaccounts(accountId: string, accounts: { id: string; publicKey: string; amount: bigint }[]) {
  const wallet = await activeWallet(accountId);
  const { PublicKey } = await import("@near-js/crypto");
  await wallet.signAndSendTransactions({
    transactions: accounts.map((a) => ({
      signerId: accountId,
      receiverId: a.id,
      actions: [actionCreators.createAccount(), actionCreators.transfer(a.amount), actionCreators.addKey(PublicKey.from(a.publicKey), actionCreators.fullAccessKey())],
    })),
  });
}

/** NEP-413 signature from the wallet, in the shape the agent's /api routes expect. */
export async function walletSignMessage(accountId: string, message: string, nonce: Uint8Array): Promise<{ publicKey: string; signature: string }> {
  const wallet = await activeWallet(accountId);
  if (!wallet.signMessage) throw new Error("This wallet can't sign messages; try MyNearWallet or Meteor");
  const signed = await wallet.signMessage({ message, recipient: CONTRACT_ID, nonce: Buffer.from(nonce) });
  if (!signed) throw new Error("The wallet did not return a signature");
  if (signed.accountId !== accountId) throw new Error(`The wallet signed as ${signed.accountId}, not ${accountId}`);
  return { publicKey: signed.publicKey, signature: signed.signature };
}

/** Restores a wallet session after a reload (the selector re-reads its own storage). */
export function resumeWallet(): void {
  if (walletAccountId()) void selector();
}
