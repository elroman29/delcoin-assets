/**
 * Delcoin — Swap SOL <-> DELCO on the Raydium CPMM pool (devnet)
 *
 * Run:  npm run swap
 *
 * Edit SWAP_CONFIG below to choose direction and amount.
 * Reads the mint and pool from delco-mint.json / delco-pool.json.
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Raydium, TxVersion, CurveCalculator } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { connection, loadWallet, loadMint, loadPool, explorer } from "./settings.js";

// ─────────────────────────────────────────────────────────────
// SWAP CONFIG — edit this block
// ─────────────────────────────────────────────────────────────
const SWAP_CONFIG = {
  // "buy"  = spend SOL, receive DELCO
  // "sell" = spend DELCO, receive SOL
  direction: "buy" as "buy" | "sell",

  // Amount you SPEND: SOL when buying, DELCO when selling
  amount: 0.1,

  // Max price movement you accept, 0.01 = 1%
  slippage: 0.01,
};
// ─────────────────────────────────────────────────────────────

async function getBalances(connection: Connection, owner: PublicKey) {
  const sol = (await connection.getBalance(owner)) / LAMPORTS_PER_SOL;
  const ata = getAssociatedTokenAddressSync(
    loadMint(),
    owner,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  let delco = 0;
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    delco = bal.value.uiAmount ?? 0;
  } catch {
    // no DELCO account yet
  }
  return { sol, delco };
}

async function main() {
  const owner = loadWallet();
  const delcoMint = loadMint().toBase58();

  const before = await getBalances(connection, owner.publicKey);
  console.log(`Wallet: ${owner.publicKey.toBase58()}`);
  console.log(`Before: ${before.sol.toFixed(4)} SOL | ${before.delco.toLocaleString()} DELCO\n`);

  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });

  // Pool data straight from the chain (Raydium's API doesn't cover devnet)
  const { poolInfo, poolKeys, rpcData } = await raydium.cpmm.getPoolInfoFromRpc(loadPool());

  const buying = SWAP_CONFIG.direction === "buy";
  const inputMint = buying ? NATIVE_MINT.toBase58() : delcoMint;
  const baseIn = inputMint === poolInfo.mintA.address;

  // Both tokens use 9 decimals
  const inputAmount = new BN(Math.round(SWAP_CONFIG.amount * 1e9).toString());

  const swapResult = CurveCalculator.swap(
    inputAmount,
    baseIn ? rpcData.baseReserve : rpcData.quoteReserve,
    baseIn ? rpcData.quoteReserve : rpcData.baseReserve,
    rpcData.configInfo!.tradeFeeRate
  );

  const expectedOut = Number(swapResult.destinationAmountSwapped.toString()) / 1e9;
  console.log(
    buying
      ? `Buying:  ${SWAP_CONFIG.amount} SOL -> ~${expectedOut.toLocaleString()} DELCO`
      : `Selling: ${SWAP_CONFIG.amount.toLocaleString()} DELCO -> ~${expectedOut} SOL`
  );

  const { execute } = await raydium.cpmm.swap({
    poolInfo,
    poolKeys,
    inputAmount,
    swapResult,
    slippage: SWAP_CONFIG.slippage,
    baseIn,
    txVersion: TxVersion.LEGACY,
  });

  const { txId } = await execute({ sendAndConfirm: true });
  console.log(`\nSwap confirmed: ${explorer("tx", txId)}`);

  const after = await getBalances(connection, owner.publicKey);
  console.log(`\nAfter:  ${after.sol.toFixed(4)} SOL | ${after.delco.toLocaleString()} DELCO`);
  console.log(
    `Change: ${(after.sol - before.sol).toFixed(4)} SOL | ` +
      `${(after.delco - before.delco).toLocaleString()} DELCO\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
