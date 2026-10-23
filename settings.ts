/**
 * Delcoin — the ONE file you edit.
 *
 * Every script reads its settings from here. The mint and pool addresses are
 * saved automatically to delco-mint.json and delco-pool.json, so you never
 * copy-paste them between scripts.
 */

import { clusterApiUrl, Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

export const SETTINGS = {
  // ── Your Phantom wallet ──
  // In Phantom: Settings → Developer Settings → Testnet Mode ON → Solana Devnet.
  // Then click your account name at the top to copy the Solana address.
  phantomAddress: "",

  // DELCO sent to Phantom at the end of `npm run relaunch`
  sendToPhantom: 10_000_000,

  // ── Token ──
  name: "Delcoin",
  symbol: "DELCO",
  uri: "https://raw.githubusercontent.com/elroman29/delcoin-assets/refs/heads/main/metadata.json",
  decimals: 9,
  supply: 1_000_000_000,
  additionalMetadata: [["origin", "Delaware County"]] as [string, string][],
  revokeMintAuthority: false, // true = supply can never change again

  // ── Multisig (npm run secure) ──
  // From devnet.squads.so → your Squad → Settings: the "Multisig Account" address.
  // (Not the Vault address. The script works out the vault and shows it to you.)
  squadsMultisig: "",

  // "multisig" = the Squads vault can mint more DELCO (needs threshold approvals)
  // "revoke"   = nobody can ever mint more DELCO; supply is fixed forever
  mintAuthorityPlan: "multisig" as "multisig" | "revoke",

  // ── Liquidity pool ──
  // Starting price = poolSol / poolDelco  (default: 0.00001 SOL per DELCO)
  poolDelco: 100_000,
  poolSol: 1,
};

// ─────────────────────────────────────────────────────────────
// Shared helpers — no need to edit below
// ─────────────────────────────────────────────────────────────

export const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

const WALLET_FILE = path.join(process.cwd(), "wallet.json");
const MINT_FILE = path.join(process.cwd(), "delco-mint.json");
const POOL_FILE = path.join(process.cwd(), "delco-pool.json");

export function loadWallet(createIfMissing = false): Keypair {
  if (fs.existsSync(WALLET_FILE)) {
    const secret = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  if (!createIfMissing) fail("wallet.json not found. Run `npm run launch` first.");
  const kp = Keypair.generate();
  fs.writeFileSync(WALLET_FILE, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`Generated new devnet wallet -> wallet.json`);
  return kp;
}

export function saveMint(mint: PublicKey) {
  fs.writeFileSync(MINT_FILE, JSON.stringify({ mint: mint.toBase58() }, null, 2));
}

export function loadMint(): PublicKey {
  if (!fs.existsSync(MINT_FILE)) fail("delco-mint.json not found. Run `npm run launch` first.");
  return new PublicKey(JSON.parse(fs.readFileSync(MINT_FILE, "utf8")).mint);
}

export function savePool(poolId: string) {
  fs.writeFileSync(POOL_FILE, JSON.stringify({ poolId }, null, 2));
}

export function loadPool(): string {
  if (!fs.existsSync(POOL_FILE)) fail("delco-pool.json not found. Run `npm run pool` first.");
  return JSON.parse(fs.readFileSync(POOL_FILE, "utf8")).poolId;
}

export function phantomPublicKey(override?: string): PublicKey {
  const addr = (override ?? SETTINGS.phantomAddress).trim();
  if (!addr) fail("Set phantomAddress in settings.ts (your Phantom wallet's Solana address).");
  try {
    return new PublicKey(addr);
  } catch {
    fail(`"${addr}" is not a valid Solana address. Copy the SOLANA address from Phantom.`);
  }
}

export function explorer(kind: "address" | "tx", id: string) {
  return `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
}

export function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}
