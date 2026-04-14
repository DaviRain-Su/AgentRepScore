// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEvidenceCommitment {
    struct EvidenceCommitment {
        bytes32 root;
        bytes32 leafHash;
        bytes32 summaryHash;
        uint64 epoch;
        uint64 blockNumber;
        uint8 proofType;
    }
}

interface IEvidenceCommitmentView is IEvidenceCommitment {
    function getEvidenceCommitment(address wallet) external view returns (EvidenceCommitment memory);
}

library EvidenceProofType {
    uint8 internal constant SUMMARY_ONLY = 0;
    uint8 internal constant MERKLE = 1;
    uint8 internal constant RECEIPT_OR_STORAGE = 2;
}
