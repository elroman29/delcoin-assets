/**
 * Delcoin — hand every DELCO authority to a Squads multisig vault
 *
 *   npm run secure              → DRY RUN: checks everything, simulates, changes nothing
 *   npm run secure -- --confirm → does it for real (one atomic transaction)
 *
 * Authorities moved from wallet.json to the Squads vault:
 *   • Mint authority             (who can create more DELCO)  — or revoked, see settings.ts
 *   • Metadata pointer authority (where wallets look for metadata)
 *   • Metadata update authority  (name, symbol, logo URI)
 * Freeze authority was never set, so there is nothing to move.
 *
 * After this, wallet.json can no longer change supply or metadata.
 * Any change needs threshold approvals in Squads (devnet.squads.so).
 */

import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  AuthorityType,
  getMint,
  getMetadataPointerState,
  getTokenMetadata,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import { createUpdateAuthorityInstruction } from "@solana/spl-token-metadata";
import * as squads from "@sqds/multisig";
import { SETTINGS, connection, loadWallet, loadMint, explorer, fail } from "./settings.js";

const CONFIRM = process.argv.includes("--confirm");

async function main() {
  const wallet = loadWallet();
  const mint = loadMint();

  console.log(CONFIRM ? "\n=== SECURE AUTHORITIES (LIVE) ===" : "\n=== SECURE AUTHORITIES (dry run, nothing will change) ===");
  console.log(`DELCO mint:   ${mint.toBase58()}`);
  console.log(`Current key:  ${wallet.publicKey.toBase58()}  (wallet.json)`);

  // ── 1. Validate the Squads multisig and derive its vault ──
  const raw = SETTINGS.squadsMultisig.trim();
  if (!raw) fail("Set squadsMultisig in settings.ts (the MULTISIG ACCOUNT address from devnet.squads.so → Settings).");
  let multisigPda: PublicKey;
  try {
    multisigPda = new PublicKey(raw);
  } catch {
    fail(`"${raw}" is not a valid Solana address.`);
  }

  const acct = await connection.getAccountInfo(multisigPda);
  if (!acct || !acct.owner.equals(squads.PROGRAM_ID)) {
    fail(
      `${multisigPda.toBase58()} is not a Squads multisig account on devnet.\n` +
        `  In devnet.squads.so → Settings, copy the "Multisig Account" address\n` +
        `  (not the Vault address — this script works out the vault itself).`
    );
  }

  const ms = await squads.accounts.Multisig.fromAccountAddress(connection, multisigPda);
  const [vault] = squads.getVaultPda({ multisigPda, index: 0 });

  console.log(`\nSquads multisig: ${multisigPda.toBase58()}`);
  console.log(`Squads vault:    ${vault.toBase58()}   ← new authority`);
  console.log(`Threshold:       ${ms.threshold} of ${ms.members.length} members`);
  ms.members.forEach((m, i) => console.log(`  member ${i + 1}: ${m.key.toBase58()}`));

  if (ms.threshold < 2) {
    fail(`Threshold is ${ms.threshold}. A 1-signature multisig adds no protection. Set it to 2 or more in Squads first.`);
  }
  if (ms.members.some((m) => m.key.equals(wallet.publicKey))) {
    fail("wallet.json is a member of the multisig. Remove it: that key lives in a cloud Codespace and shouldn't approve anything.");
  }

  // ── 2. Read current authorities ──
  const mintInfo = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const pointer = getMetadataPointerState(mintInfo);
  const metadata = await getTokenMetadata(connection, mint, "confirmed");

  const revokeMint = SETTINGS.mintAuthorityPlan === "revoke";
  const tx = new Transaction();
  const plan: string[] = [];

  if (mintInfo.mintAuthority?.equals(wallet.publicKey)) {
    tx.add(
      createSetAuthorityInstruction(
        mint,
        wallet.publicKey,
        AuthorityType.MintTokens,
        revokeMint ? null : vault,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    plan.push(revokeMint ? "Mint authority      → REVOKED (supply fixed forever)" : "Mint authority      → Squads vault");
  } else {
    console.log(`\nMint authority already ${mintInfo.mintAuthority?.toBase58() ?? "revoked"}, skipping.`);
  }

  if (pointer?.authority?.equals(wallet.publicKey)) {
    tx.add(
      createSetAuthorityInstruction(mint, wallet.publicKey, AuthorityType.MetadataPointer, vault, [], TOKEN_2022_PROGRAM_ID)
    );
    plan.push("Metadata pointer    → Squads vault");
  } else {
    console.log(`Metadata pointer authority already ${pointer?.authority?.toBase58() ?? "none"}, skipping.`);
  }

  if (metadata?.updateAuthority?.equals(wallet.publicKey)) {
    tx.add(
      createUpdateAuthorityInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        oldAuthority: wallet.publicKey,
        newAuthority: vault,
      })
    );
    plan.push("Metadata update     → Squads vault");
  } else {
    console.log(`Metadata update authority already ${metadata?.updateAuthority?.toBase58() ?? "none"}, skipping.`);
  }

  if (mintInfo.freezeAuthority) {
    console.log(`\n! Freeze authority is set (${mintInfo.freezeAuthority.toBase58()}). This script doesn't move it.`);
  }

  if (plan.length === 0) {
    console.log("\nNothing to do: wallet.json holds no DELCO authorities.\n");
    return;
  }

  console.log("\nPlan (one atomic transaction, all or nothing):");
  plan.forEach((p) => console.log(`  • ${p}`));

  // ── 3. Simulate first, always ──
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const sim = await connection.simulateTransaction(tx, [wallet]);
  if (sim.value.err) {
    console.error(sim.value.logs?.join("\n"));
    fail(`Simulation failed: ${JSON.stringify(sim.value.err)}. Nothing was changed.`);
  }
  console.log("\n✓ Simulation passed.");

  if (!CONFIRM) {
    console.log(
      `\nDry run only. Before going live, open devnet.squads.so and check that the\n` +
        `Vault address shown there is exactly:\n\n  ${vault.toBase58()}\n\n` +
        `If it matches, run:  npm run secure -- --confirm\n`
    );
    return;
  }

  // ── 4. Send for real ──
  const fresh = new Transaction().add(...tx.instructions);
  const sig = await sendAndConfirmTransaction(connection, fresh, [wallet]);
  console.log(`\nSent: ${explorer("tx", sig)}`);

  // ── 5. Verify on-chain ──
  const after = await getMint(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
  const afterPtr = getMetadataPointerState(after);
  const afterMeta = await getTokenMetadata(connection, mint, "confirmed");
  console.log("\n─── Authorities now ───");
  console.log(`Mint:             ${after.mintAuthority?.toBase58() ?? "REVOKED"}`);
  console.log(`Metadata pointer: ${afterPtr?.authority?.toBase58() ?? "none"}`);
  console.log(`Metadata update:  ${afterMeta?.updateAuthority?.toBase58() ?? "none"}`);
  console.log(`Freeze:           ${after.freezeAuthority?.toBase58() ?? "none"}`);

  const ok =
    (after.mintAuthority === null || after.mintAuthority.equals(vault)) &&
    !!afterPtr?.authority?.equals(vault) &&
    !!afterMeta?.updateAuthority?.equals(vault);
  console.log(ok ? "\n✓ All DELCO authorities are controlled by the Squads vault.\n" : "\n! Something doesn't match. Paste this output to Claude.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
