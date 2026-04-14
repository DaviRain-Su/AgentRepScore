export interface RegisterInput {
  wallet: `0x${string}`;
  /** @deprecated not used in current implementation */
  capabilities?: string[];
  uri: string;
}

export interface EvaluateInput {
  agentId: string;
}

export interface QueryInput {
  agentId: string;
}

export interface CompareInput {
  agentIds: string[];
}

export const EVIDENCE_PROOF_TYPES = {
  SUMMARY_ONLY: 0,
  MERKLE: 1,
  RECEIPT_OR_STORAGE: 2,
} as const;

export type EvidenceProofType = typeof EVIDENCE_PROOF_TYPES[keyof typeof EVIDENCE_PROOF_TYPES];

export interface EvidenceCommitment {
  root: `0x${string}`;
  leafHash: `0x${string}`;
  summaryHash: `0x${string}`;
  epoch: number;
  blockNumber: number;
  proofType: EvidenceProofType;
}

export interface CorrelationAssessmentOutput {
  penalty: number;
  ruleCount: number;
  evidenceHash: `0x${string}`;
  timestamp: number;
}

export interface CompareResultItem {
  agentId: string;
  decayedScore: number;
  trustTier: "untrusted" | "basic" | "verified" | "elite";
  correlationPenalty: number;
  correlationRuleCount: number;
  error?: string;
}

export interface ModulesOutput {
  modules: {
    name: string;
    category: string;
    address: `0x${string}`;
    weight: number;
    effectiveBaseWeight?: number;
    active: boolean;
  }[];
}

export interface ScoreOutput {
  agentId: string;
  wallet: `0x${string}`;
  rawScore: number;
  decayedScore: number;
  trustTier: "untrusted" | "basic" | "verified" | "elite";
  timestamp: number;
  evidenceHash?: `0x${string}`;
  correlation: CorrelationAssessmentOutput;
  moduleBreakdown: {
    name: string;
    score: number;
    confidence: number;
    weight: number;
    effectiveBaseWeight?: number;
    effectiveWeight?: number;
  }[];
}
