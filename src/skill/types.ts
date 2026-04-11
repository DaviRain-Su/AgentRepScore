export interface RegisterInput {
  wallet: `0x${string}`;
  capabilities: string[];
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

export interface ModulesOutput {
  modules: {
    name: string;
    category: string;
    address: `0x${string}`;
    weight: number;
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
  moduleBreakdown: {
    name: string;
    score: number;
    confidence: number;
    weight: number;
  }[];
}
