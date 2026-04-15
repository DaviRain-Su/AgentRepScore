import {
  aaveEvidenceCommitmentAbi,
  baseActivityEvidenceCommitmentAbi,
  uniswapEvidenceCommitmentAbi,
} from "./abis.ts";
import type { EvidenceCommitmentAcceptance, EvidenceStatusOutput } from "./types.ts";

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

interface ContractReader {
  readContract(params: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
}

export interface ModuleEvidenceInput {
  name: string;
  address: `0x${string}`;
  confidence: number;
  active: boolean;
}

export interface ResolveEvidenceStatusInput {
  wallet: `0x${string}`;
  modules: ModuleEvidenceInput[];
  reader: ContractReader;
}

function commitmentGetterForModule(moduleName: string):
  | { abi: typeof uniswapEvidenceCommitmentAbi; functionName: "getAcceptedSwapCommitment" }
  | { abi: typeof baseActivityEvidenceCommitmentAbi; functionName: "getAcceptedActivityCommitment" }
  | { abi: typeof aaveEvidenceCommitmentAbi; functionName: "getAcceptedWalletMetaCommitment" }
  | null {
  const normalized = moduleName.toLowerCase();
  if (normalized.includes("uniswap")) {
    return { abi: uniswapEvidenceCommitmentAbi, functionName: "getAcceptedSwapCommitment" };
  }
  if (normalized.includes("activity")) {
    return { abi: baseActivityEvidenceCommitmentAbi, functionName: "getAcceptedActivityCommitment" };
  }
  if (normalized.includes("aave")) {
    return { abi: aaveEvidenceCommitmentAbi, functionName: "getAcceptedWalletMetaCommitment" };
  }
  return null;
}

function toAcceptance(raw: unknown): EvidenceCommitmentAcceptance | null {
  if (!Array.isArray(raw) || raw.length < 8) {
    return null;
  }

  return {
    accepted: Boolean(raw[0]),
    root: raw[1] as `0x${string}`,
    leafHash: raw[2] as `0x${string}`,
    summaryHash: raw[3] as `0x${string}`,
    epoch: Number(raw[4]),
    blockNumber: Number(raw[5]),
    proofType: Number(raw[6]) as EvidenceCommitmentAcceptance["proofType"],
    verifiedAt: Number(raw[7]),
  };
}

function isAcceptedCommitment(
  commitment: EvidenceCommitmentAcceptance | null
): commitment is EvidenceCommitmentAcceptance {
  return !!commitment && commitment.accepted && commitment.summaryHash !== ZERO_HASH;
}

async function readAcceptedCommitment(
  reader: ContractReader,
  moduleName: string,
  moduleAddress: `0x${string}`,
  wallet: `0x${string}`
): Promise<EvidenceCommitmentAcceptance | null> {
  const getter = commitmentGetterForModule(moduleName);
  if (!getter) {
    return null;
  }

  try {
    const raw = await reader.readContract({
      address: moduleAddress,
      abi: getter.abi,
      functionName: getter.functionName,
      args: [wallet],
    });
    return toAcceptance(raw);
  } catch {
    return null;
  }
}

export async function resolveEvidenceStatus(input: ResolveEvidenceStatusInput): Promise<EvidenceStatusOutput> {
  const contributingModules = input.modules.filter((module) => module.active && module.confidence > 0);
  if (contributingModules.length === 0) {
    return {
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    };
  }

  const statuses = await Promise.all(
    contributingModules.map(async (module) => ({
      module,
      commitment: await readAcceptedCommitment(input.reader, module.name, module.address, input.wallet),
    }))
  );

  const allContributingModulesVerified = statuses.every((status) => isAcceptedCommitment(status.commitment));
  if (!allContributingModulesVerified) {
    return {
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    };
  }

  const acceptedCommitments = statuses.map((status) => status.commitment).filter(isAcceptedCommitment);
  const primaryCommitment = acceptedCommitments.reduce<EvidenceCommitmentAcceptance | null>(
    (latest, current) => (latest === null || current.verifiedAt > latest.verifiedAt ? current : latest),
    null
  );

  if (!primaryCommitment) {
    return {
      verifiedEvidence: false,
      evidenceMode: "legacy-summary",
    };
  }

  return {
    verifiedEvidence: true,
    evidenceMode: "accepted-commitment",
    proofType: primaryCommitment.proofType,
    commitment: {
      root: primaryCommitment.root,
      leafHash: primaryCommitment.leafHash,
      summaryHash: primaryCommitment.summaryHash,
      epoch: primaryCommitment.epoch,
      blockNumber: String(primaryCommitment.blockNumber),
    },
  };
}
