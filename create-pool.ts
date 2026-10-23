/**
 * Delcoin — create a Raydium CPMM pool pairing DELCO with SOL (devnet)
 *
 * Run:  npm run pool
 * Reads the mint from delco-mint.json; saves the pool ID to delco-pool.json.
 */

import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import { Raydium, TxVersion, DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";
import { SETTINGS, connection, loadWallet, loadMint, savePool, explorer, fail } from "./settings.js";

async function main() {
  const owner = loadWallet();
  const delcoMint = loadMint();

  const balance = await connection.getBalance(owner.publicKey);
  console.log(`\nWallet:  ${owner.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log(`DELCO:   ${delcoMint.toBase58()}`);

  const needed = SETTINGS.poolSol + 0.5; // liquidity + pool creation fees/rent
  if (balance < needed * LAMPORTS_PER_SOL) {
    fail(
      `Need at least ${needed} SOL. Fund at https://faucet.solana.com :\n  ${owner.publicKey.toBase58()}`
    );
  }

  console.log("\nLoading Raydium (devnet)...");
  const raydium = await Raydium.load({
    connection,
    owner,
    cluster: "devnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });

  // Raydium's API returns mainnet config IDs; re-derive them for devnet.
  const feeConfigs = await raydium.api.getCpmmConfigs();
  feeConfigs.forEach((c) => {
    c.id = getCpmmPdaAmmConfigId(DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM, c.index).publicKey.toBase58();
  });
  const feeConfig = feeConfigs[0];
  console.log(`Fee tier: ${feeConfig.tradeFeeRate / 10000}%`);

  // Raydium orders the two tokens by their raw address bytes.
  const delcoFirst = Buffer.compare(delcoMint.toBuffer(), NATIVE_MINT.toBuffer()) < 0;

  const delco = {
    address: delcoMint.toBase58(),
    programId: TOKEN_2022_PROGRAM_ID.toBase58(),
    decimals: SETTINGS.decimals,
  };
  const wsol = {
    address: NATIVE_MINT.toBase58(),
    programId: TOKEN_PROGRAM_ID.toBase58(),
    decimals: 9,
  };
  const delcoRaw = new BN(SETTINGS.poolDelco).mul(new BN(10).pow(new BN(SETTINGS.decimals)));
  const solRaw = new BN(Math.round(SETTINGS.poolSol * LAMPORTS_PER_SOL));

  console.log(
    `\nCreating pool: ${SETTINGS.poolDelco.toLocaleString()} DELCO + ${SETTINGS.poolSol} SOL` +
      `  (price ${(SETTINGS.poolSol / SETTINGS.poolDelco).toFixed(9)} SOL per DELCO)`
  );

  const { execute, extInfo } = await raydium.cpmm.createPool({
    programId: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM,
    poolFeeAccount: DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC,
    mintA: delcoFirst ? delco : wsol,
    mintB: delcoFirst ? wsol : delco,
    mintAAmount: delcoFirst ? delcoRaw : solRaw,
    mintBAmount: delcoFirst ? solRaw : delcoRaw,
    startTime: new BN(0),
    feeConfig,
    associatedOnly: false,
    ownerInfo: { useSOLBalance: true },
    txVersion: TxVersion.LEGACY,
  });

  const poolId = extInfo.address.poolId.toBase58();
  const { txId } = await execute({ sendAndConfirm: true });
  savePool(poolId);

  console.log("\n─── Pool live on devnet ───");
  console.log(`Pool ID:  ${poolId}  (saved to delco-pool.json)`);
  console.log(`TX:       ${explorer("tx", txId)}`);
  console.log(`Explorer: ${explorer("address", poolId)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
