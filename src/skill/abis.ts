export const identityRegistryAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getAgentWallet",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "string", name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "agentId", type: "uint256" },
      { internalType: "address", name: "newWallet", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes", name: "signature", type: "bytes" },
    ],
    name: "setAgentWallet",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "agentId", type: "uint256" },
      { indexed: false, internalType: "string", name: "agentURI", type: "string" },
      { indexed: true, internalType: "address", name: "owner", type: "address" },
    ],
    name: "Registered",
    type: "event",
  },
] as const;

export const evidenceCommitmentTupleComponents = [
  { internalType: "bytes32", name: "root", type: "bytes32" },
  { internalType: "bytes32", name: "leafHash", type: "bytes32" },
  { internalType: "bytes32", name: "summaryHash", type: "bytes32" },
  { internalType: "uint64", name: "epoch", type: "uint64" },
  { internalType: "uint64", name: "blockNumber", type: "uint64" },
  { internalType: "uint8", name: "proofType", type: "uint8" },
] as const;

export const evidenceCommitmentViewAbi = [
  {
    inputs: [{ internalType: "address", name: "wallet", type: "address" }],
    name: "getEvidenceCommitment",
    outputs: [
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const uniswapEvidenceCommitmentAbi = [
  {
    inputs: [{ internalType: "address", name: "wallet", type: "address" }],
    name: "getLatestSwapCommitment",
    outputs: [
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "submitSwapCommitment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const baseActivityEvidenceCommitmentAbi = [
  {
    inputs: [{ internalType: "address", name: "wallet", type: "address" }],
    name: "getLatestActivityCommitment",
    outputs: [
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "submitActivityCommitment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const aaveEvidenceCommitmentAbi = [
  {
    inputs: [{ internalType: "address", name: "wallet", type: "address" }],
    name: "getLatestWalletMetaCommitment",
    outputs: [
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "wallet", type: "address" },
      {
        components: evidenceCommitmentTupleComponents,
        internalType: "struct IEvidenceCommitment.EvidenceCommitment",
        name: "commitment",
        type: "tuple",
      },
    ],
    name: "submitWalletMetaCommitment",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const validatorAbi = [
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "evaluateAgent",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getLatestScore",
    outputs: [
      { internalType: "int256", name: "score", type: "int256" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getModuleScores",
    outputs: [
      { internalType: "string[]", name: "names", type: "string[]" },
      { internalType: "int256[]", name: "scores", type: "int256[]" },
      { internalType: "uint256[]", name: "confidences", type: "uint256[]" },
      { internalType: "bytes32[]", name: "evidences", type: "bytes32[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getModulesWithNames",
    outputs: [
      { internalType: "address[]", name: "addresses_", type: "address[]" },
      { internalType: "string[]", name: "names", type: "string[]" },
      { internalType: "string[]", name: "categories", type: "string[]" },
      { internalType: "uint256[]", name: "weights", type: "uint256[]" },
      { internalType: "bool[]", name: "activeStates", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getEffectiveWeights",
    outputs: [
      { internalType: "string[]", name: "names", type: "string[]" },
      { internalType: "uint256[]", name: "nominalWeights", type: "uint256[]" },
      { internalType: "uint256[]", name: "effectiveBaseWeights", type: "uint256[]" },
      { internalType: "bool[]", name: "activeStates", type: "bool[]" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getWeightPolicy",
    outputs: [
      { internalType: "bool", name: "enabled", type: "bool" },
      { internalType: "uint16", name: "minWeightBps", type: "uint16" },
      { internalType: "uint16", name: "decayStepBps", type: "uint16" },
      { internalType: "uint16", name: "recoveryStepBps", type: "uint16" },
      { internalType: "uint8", name: "zeroConfidenceThreshold", type: "uint8" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "moduleIndex", type: "uint256" }],
    name: "getModuleRuntimeState",
    outputs: [
      { internalType: "uint256", name: "zeroConfidenceStreak", type: "uint256" },
      { internalType: "uint256", name: "effectiveBaseWeight", type: "uint256" },
      { internalType: "uint256", name: "lastUpdatedAt", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "agentId", type: "uint256" }],
    name: "getCorrelationAssessment",
    outputs: [
      { internalType: "int256", name: "penalty", type: "int256" },
      { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
      { internalType: "uint8", name: "ruleCount", type: "uint8" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCorrelationPolicy",
    outputs: [
      { internalType: "bool", name: "enabled", type: "bool" },
      { internalType: "bool", name: "washSybilEnabled", type: "bool" },
      { internalType: "bool", name: "concentrationLowCounterpartiesEnabled", type: "bool" },
      { internalType: "bool", name: "youngWalletHighVolumeEnabled", type: "bool" },
      { internalType: "uint256", name: "highSwapThreshold", type: "uint256" },
      { internalType: "uint256", name: "lowCounterpartiesThreshold", type: "uint256" },
      { internalType: "uint256", name: "highVolumeThreshold", type: "uint256" },
      { internalType: "uint256", name: "youngWalletDaysThreshold", type: "uint256" },
      { internalType: "uint256", name: "penaltyWashSybil", type: "uint256" },
      { internalType: "uint256", name: "penaltyConcentrationLowCounterparties", type: "uint256" },
      { internalType: "uint256", name: "penaltyYoungWalletHighVolume", type: "uint256" },
      { internalType: "uint256", name: "maxPenalty", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "bool", name: "enabled", type: "bool" },
      { internalType: "bool", name: "washSybilEnabled", type: "bool" },
      { internalType: "bool", name: "concentrationLowCounterpartiesEnabled", type: "bool" },
      { internalType: "bool", name: "youngWalletHighVolumeEnabled", type: "bool" },
      { internalType: "uint256", name: "highSwapThreshold", type: "uint256" },
      { internalType: "uint256", name: "lowCounterpartiesThreshold", type: "uint256" },
      { internalType: "uint256", name: "highVolumeThreshold", type: "uint256" },
      { internalType: "uint256", name: "youngWalletDaysThreshold", type: "uint256" },
      { internalType: "uint256", name: "penaltyWashSybil", type: "uint256" },
      { internalType: "uint256", name: "penaltyConcentrationLowCounterparties", type: "uint256" },
      { internalType: "uint256", name: "penaltyYoungWalletHighVolume", type: "uint256" },
      { internalType: "uint256", name: "maxPenalty", type: "uint256" },
    ],
    name: "setCorrelationPolicy",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "modules",
    outputs: [
      { internalType: "contract IScoreModule", name: "module", type: "address" },
      { internalType: "uint256", name: "weight", type: "uint256" },
      { internalType: "bool", name: "active", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "moduleCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const moduleNameAbi = [
  {
    inputs: [],
    name: "name",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "category",
    outputs: [{ internalType: "string", name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export const agentEvaluatedEventAbi = {
  type: "event",
  name: "AgentEvaluated",
  inputs: [
    { indexed: true, name: "agentId", type: "uint256" },
    { indexed: false, name: "score", type: "int256" },
    { indexed: false, name: "normalizedScore", type: "int128" },
    { indexed: false, name: "valueDecimals", type: "uint8" },
    { indexed: false, name: "evidenceHash", type: "bytes32" },
  ],
} as const;

export const swapSummarySubmittedEventAbi = {
  type: "event",
  name: "SwapSummarySubmitted",
  inputs: [
    { indexed: true, name: "wallet", type: "address" },
    { indexed: false, name: "swapCount", type: "uint256" },
    { indexed: false, name: "volumeUSD", type: "uint256" },
    { indexed: false, name: "netPnL", type: "int256" },
    { indexed: false, name: "washTradeFlag", type: "bool" },
    { indexed: false, name: "counterpartyConcentrationFlag", type: "bool" },
    { indexed: false, name: "evidenceHash", type: "bytes32" },
    { indexed: false, name: "pool", type: "address" },
  ],
} as const;

export const activitySummarySubmittedEventAbi = {
  type: "event",
  name: "ActivitySummarySubmitted",
  inputs: [
    { indexed: true, name: "wallet", type: "address" },
    { indexed: false, name: "txCount", type: "uint256" },
    { indexed: false, name: "uniqueCounterparties", type: "uint256" },
    { indexed: false, name: "evidenceHash", type: "bytes32" },
    { indexed: false, name: "sybilClusterFlag", type: "bool" },
  ],
} as const;
