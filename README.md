# Delcoin (DELCO) — devnet relaunch kit

## One-time setup in your Codespace

1. Upload `delcoin-relaunch.zip` into the Codespace file list.
2. In the terminal:
   ```
   unzip -o delcoin-relaunch.zip && npm ci
   ```
   This replaces the old scripts but **keeps your `wallet.json`** (it isn't in the zip).
3. Open `settings.ts` and paste your Phantom wallet's Solana address into `phantomAddress`.

## Relaunch

```
npm run relaunch
```

That runs four steps in order and stops at the first problem:

| Step | What it does |
|---|---|
| `check`  | Confirms your Phantom address, SOL balance and logo link *before* anything is created |
| `launch` | Creates a new DELCO token and mints 1,000,000,000 to `wallet.json` |
| `pool`   | Creates the Raydium DELCO/SOL pool |
| `send`   | Sends DELCO to your Phantom wallet |

Each step can also be run on its own (`npm run pool`, `npm run send`, …).
`npm run swap` buys DELCO with 0.1 SOL. Edit the top of `swap.ts` to sell instead.

## Rules that keep it working

- **Never run `npm audit fix`.** The versions are pinned on purpose; it breaks them.
- Use `npm ci`, not `npm install`, after unzipping.
- `npm run launch` creates a **new** token every time. Run it once.
- Mint and pool addresses are saved to `delco-mint.json` and `delco-pool.json`
  automatically. These are public addresses and safe to commit.
- `wallet.json` is a private key. It stays gitignored and is for devnet only.

## Lock down authorities with a multisig (`npm run secure`)

Moves the mint, metadata-pointer and metadata-update authorities from
`wallet.json` to a Squads multisig vault, in one all-or-nothing transaction.

1. At https://devnet.squads.so connect Phantom and create a Squad:
   at least 2 members and a threshold of 2 or more. Don't add `wallet.json`.
2. In the Squad's **Settings**, copy the **Multisig Account** address
   into `squadsMultisig` in `settings.ts`.
3. `npm run secure` does a dry run. It checks the Squad, simulates, and prints the vault address.
   Confirm that vault address matches the one Squads shows.
4. `npm run secure -- --confirm` makes the change for real.

Set `mintAuthorityPlan: "revoke"` instead if no one should ever mint more DELCO.
