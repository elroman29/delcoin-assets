/**
 * Delcoin — create the DELCO token (Token-2022, metadata stored in the mint)
 *
 * Run:  npm run launch
 * Each run creates a BRAND-NEW token. The new mint address is saved to
 * delco-mint.json, which the pool, swap and send scripts read automatically.
 */

import {
  Keypair,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  AuthorityType,
  ExtensionType,
  TYPE_SIZE,
  LENGTH_SIZE,
  getMintLen,
  getMint,
  getTokenMetadata,
  getAssociatedTokenAddressSync,
  createInitializeMintInstruction,
  createInitializeMetadataPointerInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import { SETTINGS, connection, loadWallet, saveMint, explorer, fail } from "./settings.js";

async function ensureFunded(payer: Keypair) {
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (balance >= 0.5 * LAMPORTS_PER_SOL) return;

  console.log("Requesting devnet airdrop...");
  try {
    const sig = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log("Airdrop confirmed.");
  } catch {
    fail(
      `Airdrop failed (the devnet faucet is rate-limited).\n` +
        `  Fund this address at https://faucet.solana.com and re-run:\n` +
        `  ${payer.publicKey.toBase58()}`
    );
  }
}

async function main() {
  const payer = loadWallet(true);
  console.log(`\nWallet: ${payer.publicKey.toBase58()}`);
  await ensureFunded(payer);

  const mint = Keypair.generate();
  console.log(`Mint:   ${mint.publicKey.toBase58()}\n`);

  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    name: SETTINGS.name,
    symbol: SETTINGS.symbol,
    uri: SETTINGS.uri,
    additionalMetadata: SETTINGS.additionalMetadata,
  };

  // Allocate space for the fixed extensions; fund rent for the final size,
  // because Token-2022 grows the account when metadata is initialized.
  const mintLen = getMintLen([ExtensionType.MetadataPointer]);
  const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  // Transaction 1 — create the mint. Order matters:
  // metadata pointer BEFORE initializeMint, metadata AFTER it.
  const createTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMetadataPointerInstruction(
      mint.publicKey,
      payer.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeMintInstruction(
      mint.publicKey,
      SETTINGS.decimals,
      payer.publicKey, // mint authority
      null, // no freeze authority
      TOKEN_2022_PROGRAM_ID
    ),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint.publicKey,
      updateAuthority: payer.publicKey,
      mint: mint.publicKey,
      mintAuthority: payer.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    ...metadata.additionalMetadata.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        updateAuthority: payer.publicKey,
        field,
        value,
      })
    )
  );
  const createSig = await sendAndConfirmTransaction(connection, createTx, [payer, mint]);
  console.log(`Mint created:  ${createSig}`);

  // Save immediately so the other scripts can find it even if a later step fails
  saveMint(mint.publicKey);

  // Transaction 2 — mint the full supply into wallet.json's token account
  const ata = getAssociatedTokenAddressSync(mint.publicKey, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const rawSupply = BigInt(SETTINGS.supply) * 10n ** BigInt(SETTINGS.decimals);
  const mintTx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      ata,
      payer.publicKey,
      mint.publicKey,
      TOKEN_2022_PROGRAM_ID
    ),
    createMintToInstruction(mint.publicKey, ata, payer.publicKey, rawSupply, [], TOKEN_2022_PROGRAM_ID)
  );
  const mintSig = await sendAndConfirmTransaction(connection, mintTx, [payer]);
  console.log(`Supply minted: ${mintSig}`);

  if (SETTINGS.revokeMintAuthority) {
    const revokeTx = new Transaction().add(
      createSetAuthorityInstruction(
        mint.publicKey,
        payer.publicKey,
        AuthorityType.MintTokens,
        null,
        [],
        TOKEN_2022_PROGRAM_ID
      )
    );
    const revokeSig = await sendAndConfirmTransaction(connection, revokeTx, [payer]);
    console.log(`Mint authority revoked: ${revokeSig}`);
  }

  // Read it back from the chain to confirm
  const info = await getMint(connection, mint.publicKey, "confirmed", TOKEN_2022_PROGRAM_ID);
  const onChain = await getTokenMetadata(connection, mint.publicKey);

  console.log("\n─── DELCO live on devnet ───");
  console.log(`Mint:      ${mint.publicKey.toBase58()}  (saved to delco-mint.json)`);
  console.log(`Name:      ${onChain?.name}`);
  console.log(`Symbol:    ${onChain?.symbol}`);
  console.log(`URI:       ${onChain?.uri || "(none)"}`);
  console.log(`Supply:    ${(Number(info.supply) / 10 ** info.decimals).toLocaleString()}`);
  console.log(`Authority: ${info.mintAuthority?.toBase58() ?? "revoked (supply fixed)"}`);
  console.log(`Explorer:  ${explorer("address", mint.publicKey.toBase58())}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
