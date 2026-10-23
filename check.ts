/**
 * Delcoin — pre-flight check before `npm run relaunch`
 * Catches setup problems BEFORE anything is created on-chain.
 */

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SETTINGS, connection, loadWallet, phantomPublicKey, fail } from "./settings.js";

async function main() {
  console.log("\nPre-flight check");

  const phantom = phantomPublicKey();
  console.log(`  ✓ Phantom address: ${phantom.toBase58()}`);

  const wallet = loadWallet(true);
  if (wallet.publicKey.equals(phantom)) {
    fail("phantomAddress is the same as wallet.json. Paste your PHANTOM address in settings.ts.");
  }
  console.log(`  ✓ Launch wallet:   ${wallet.publicKey.toBase58()}`);

  const sol = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
  const needed = SETTINGS.poolSol + 1;
  if (sol < needed) {
    fail(
      `Launch wallet has ${sol.toFixed(4)} SOL; relaunch needs about ${needed} SOL.\n` +
        `  Fund it at https://faucet.solana.com :\n  ${wallet.publicKey.toBase58()}`
    );
  }
  console.log(`  ✓ Balance:         ${sol.toFixed(4)} SOL`);

  const keep = SETTINGS.supply - SETTINGS.poolDelco - SETTINGS.sendToPhantom;
  if (keep < 0) fail("poolDelco + sendToPhantom is more than the total supply.");

  try {
    const res = await fetch(SETTINGS.uri);
    const json = (await res.json()) as { image?: string };
    if (!json.image || json.image.includes("example")) {
      console.log(`  ! metadata.json has no real "image" URL. The logo won't show in Phantom.`);
    } else {
      console.log(`  ✓ Metadata + logo:  ${json.image}`);
    }
  } catch {
    console.log(`  ! Couldn't read ${SETTINGS.uri}. The logo may not show in Phantom.`);
  }

  console.log(
    `\nPlan: mint ${SETTINGS.supply.toLocaleString()} DELCO → ` +
      `${SETTINGS.poolDelco.toLocaleString()} into the pool with ${SETTINGS.poolSol} SOL → ` +
      `${SETTINGS.sendToPhantom.toLocaleString()} to Phantom → ` +
      `${keep.toLocaleString()} stay in wallet.json\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
