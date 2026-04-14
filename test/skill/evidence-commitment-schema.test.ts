import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  aaveEvidenceCommitmentAbi,
  baseActivityEvidenceCommitmentAbi,
  evidenceCommitmentAcceptanceTupleComponents,
  evidenceCommitmentTupleComponents,
  evidenceCommitmentViewAbi,
  identityRegistryAbi,
  uniswapEvidenceCommitmentAbi,
  validatorAbi,
} from "../../src/skill/abis.ts";
import {
  EVIDENCE_PROOF_TYPES,
  type EvidenceCommitment,
  type EvidenceCommitmentAcceptance,
} from "../../src/skill/types.ts";

function readSolidityStructFields(structName: string): { type: string; name: string }[] {
  const source = readFileSync(
    new URL("../../contracts/interfaces/IEvidenceCommitment.sol", import.meta.url),
    "utf8"
  );
  const match = source.match(new RegExp(`struct\\s+${structName}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`));
  if (!match) {
    throw new Error(`struct ${structName} not found`);
  }
  return Array.from(match[1].matchAll(/^\s*([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*;/gm)).map(
    ([, type, name]) => ({ type, name })
  );
}

type AbiTupleParam = {
  components?: unknown;
  internalType?: string;
  type?: string;
};

describe("evidence commitment schema", () => {
  it("keeps proof type constants compatible with EvidenceCommitment", () => {
    const commitments: EvidenceCommitment[] = [
      {
        root: "0x0000000000000000000000000000000000000000000000000000000000000001",
        leafHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
        summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        epoch: 1,
        blockNumber: 100,
        proofType: EVIDENCE_PROOF_TYPES.SUMMARY_ONLY,
      },
      {
        root: "0x0000000000000000000000000000000000000000000000000000000000000001",
        leafHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
        summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        epoch: 2,
        blockNumber: 101,
        proofType: EVIDENCE_PROOF_TYPES.MERKLE,
      },
      {
        root: "0x0000000000000000000000000000000000000000000000000000000000000001",
        leafHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
        summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        epoch: 3,
        blockNumber: 102,
        proofType: EVIDENCE_PROOF_TYPES.RECEIPT_OR_STORAGE,
      },
    ];

    expect(commitments.map((c) => c.proofType)).toEqual([
      EVIDENCE_PROOF_TYPES.SUMMARY_ONLY,
      EVIDENCE_PROOF_TYPES.MERKLE,
      EVIDENCE_PROOF_TYPES.RECEIPT_OR_STORAGE,
    ]);
  });

  it("keeps tuple ABI synced with Solidity struct fields", () => {
    const solidityFields = readSolidityStructFields("EvidenceCommitment");
    const abiFields = evidenceCommitmentTupleComponents.map(({ type, name }) => ({ type, name }));

    expect(abiFields).toEqual(solidityFields);
  });

  it("keeps acceptance tuple ABI synced with Solidity struct fields", () => {
    const acceptanceState: EvidenceCommitmentAcceptance = {
      accepted: true,
      root: "0x0000000000000000000000000000000000000000000000000000000000000001",
      leafHash: "0x0000000000000000000000000000000000000000000000000000000000000002",
      summaryHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
      epoch: 10,
      blockNumber: 1_000_000,
      proofType: EVIDENCE_PROOF_TYPES.MERKLE,
      verifiedAt: 1_700_000_000,
    };
    expect(acceptanceState.accepted).toBe(true);

    const solidityFields = readSolidityStructFields("EvidenceCommitmentAcceptance");
    const abiFields = evidenceCommitmentAcceptanceTupleComponents.map(({ type, name }) => ({ type, name }));

    expect(abiFields).toEqual(solidityFields);
  });

  it("keeps getEvidenceCommitment ABI wired to shared tuple definition", () => {
    const output = evidenceCommitmentViewAbi[0]?.outputs?.[0];
    expect(output?.type).toBe("tuple");
    expect(output?.components).toEqual(evidenceCommitmentTupleComponents);
    expect(output?.internalType).toBe("struct IEvidenceCommitment.EvidenceCommitment");
  });

  it("keeps module commitment ABIs wired to shared tuple definition", () => {
    const moduleAbis = [
      uniswapEvidenceCommitmentAbi,
      baseActivityEvidenceCommitmentAbi,
      aaveEvidenceCommitmentAbi,
    ];

    for (const abi of moduleAbis) {
      const getter = abi.find((entry) => entry.type === "function" && entry.name.startsWith("getLatest"));
      const submit = abi.find((entry) => entry.type === "function" && entry.name.startsWith("submit"));
      const acceptedGetter = abi.find((entry) => entry.type === "function" && entry.name.startsWith("getAccepted"));
      const accept = abi.find((entry) => entry.type === "function" && entry.name.startsWith("accept"));

      const getterOutput = getter?.outputs?.[0] as AbiTupleParam | undefined;
      const submitInput = submit?.inputs?.[1] as AbiTupleParam | undefined;
      const acceptedGetterOutput = acceptedGetter?.outputs?.[0] as AbiTupleParam | undefined;
      const acceptProofInput = accept?.inputs?.[1] as AbiTupleParam | undefined;

      expect(getterOutput?.components).toEqual(evidenceCommitmentTupleComponents);
      expect(submitInput?.components).toEqual(evidenceCommitmentTupleComponents);
      expect(getterOutput?.internalType).toBe("struct IEvidenceCommitment.EvidenceCommitment");
      expect(submitInput?.internalType).toBe("struct IEvidenceCommitment.EvidenceCommitment");

      expect(acceptedGetterOutput?.components).toEqual(evidenceCommitmentAcceptanceTupleComponents);
      expect(acceptedGetterOutput?.internalType).toBe("struct IEvidenceCommitment.EvidenceCommitmentAcceptance");
      expect(acceptProofInput?.type).toBe("bytes32[]");
    }
  });

  it("keeps evaluate path ABIs intact", () => {
    const validatorFunctions = validatorAbi.filter((entry) => entry.type === "function");
    const validatorNames = validatorFunctions.map((entry) => entry.name);
    expect(validatorNames).toEqual(
      expect.arrayContaining([
        "evaluateAgent",
        "getLatestScore",
        "getModuleScores",
        "getModulesWithNames",
        "getEffectiveWeights",
        "getCorrelationAssessment",
      ])
    );

    const identityFunctions = identityRegistryAbi.filter((entry) => entry.type === "function");
    const identityNames = identityFunctions.map((entry) => entry.name);
    expect(identityNames).toContain("getAgentWallet");
  });
});
