export interface TxRecord {
  from: string;
  to: string;
  timestamp: number;
}

export function detectFundingClusters(
  wallets: string[],
  transactions: TxRecord[]
): Set<string> {
  const walletSet = new Set(wallets.map((w) => w.toLowerCase()));
  const flagged = new Set<string>();

  const walletToEarliestIncoming = new Map<
    string,
    { from: string; timestamp: number }
  >();

  for (const tx of transactions) {
    const to = tx.to.toLowerCase();
    if (!walletSet.has(to)) continue;

    const existing = walletToEarliestIncoming.get(to);
    if (!existing || tx.timestamp < existing.timestamp) {
      walletToEarliestIncoming.set(to, {
        from: tx.from.toLowerCase(),
        timestamp: tx.timestamp,
      });
    }
  }

  const fundingGroups = new Map<string, string[]>();
  for (const [wallet, earliest] of walletToEarliestIncoming) {
    const group = fundingGroups.get(earliest.from) || [];
    group.push(wallet);
    fundingGroups.set(earliest.from, group);
  }

  for (const [, groupWallets] of fundingGroups) {
    if (groupWallets.length >= 3) {
      for (const w of groupWallets) {
        flagged.add(w);
      }
    }
  }

  return flagged;
}
