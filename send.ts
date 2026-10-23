/**
 * Delcoin — send DELCO from wallet.json to your Phantom wallet
 *
 * Run:  npm run send                       (uses phantomAddress + sendToPhantom from settings.ts)
 *       npm run send -- <ADDRESS> <AMOUNT>  (send to any address)
 */

import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { SETTINGS, connection, loadWallet, loadMint, phantomPublicKey, explorer, fail } from "./settings.js";

async function main() {
  const [addrArg, amountArg] = process.argv.slice(2);
  const sender = loadWallet();
  const mint = loadMint();
  const recipient = phantomPublicKey(addrArg);

  const amount = amountArg !== undefined ? Number(amountArg) : SETTINGS.sendToPhantom;
  if (!Number.isFinite(amount) || amount <= 0) fail(`"${amountArg}" is not a valid amount.`);

  const fromAta = getAssociatedTokenAddressSync(mint, sender.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, recipient, false, TOKEN_2022_PROGRAM_ID);
  const raw = BigInt(Math.round(amount * 1e6)) * 10n ** BigInt(SETTINGS.decimals - 6);

  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      sender.publicKey,
      toAta,
      recipient,
      mint,
      TOKEN_2022_PROGRAM_ID
    ),
    createTransferCheckedInstruction(
      fromAta,
      mint,
      toAta,
      sender.publicKey,
      raw,
      SETTINGS.decimals,
      [],
      TOKEN_2022_PROGRAM_ID
    )
  );

  console.log(`\nSending ${amount.toLocaleString()} DELCO to ${recipient.toBase58()}...`);
  const sig = await sendAndConfirmTransaction(connection, tx, [sender]);

  const bal = await connection.getTokenAccountBalance(toAta);
  console.log(`\n─── Sent ───`);
  console.log(`Recipient now holds: ${bal.value.uiAmountString} DELCO`);
  console.log(`TX:              ${explorer("tx", sig)}`);
  console.log(`Recipient tokens: https://explorer.solana.com/address/${recipient.toBase58()}/tokens?cluster=devnet`);
  console.log(
    `\nIn Phantom: Testnet Mode ON + Solana Devnet. If DELCO is missing,` +
      `\nscroll to the bottom of the token list → Manage token list → turn DELCO on.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
