// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IEvidenceCommitment.sol";

library EvidenceCommitmentLib {
    function isValidProofType(uint8 proofType) internal pure returns (bool) {
        return proofType == EvidenceProofType.SUMMARY_ONLY || proofType == EvidenceProofType.MERKLE
            || proofType == EvidenceProofType.RECEIPT_OR_STORAGE;
    }

    function hashLeaf(string memory moduleKey, address wallet, uint64 epoch, uint64 blockNumber, bytes32 summaryHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(moduleKey, wallet, epoch, blockNumber, summaryHash));
    }

    function verifyProof(bytes32 leafHash, bytes32[] calldata proof, bytes32 expectedRoot)
        internal
        pure
        returns (bool)
    {
        bytes32 computed = leafHash;
        for (uint256 i = 0; i < proof.length; i++) {
            computed = hashSortedPair(computed, proof[i]);
        }
        return computed == expectedRoot;
    }

    function verifyCommitment(IEvidenceCommitment.EvidenceCommitment memory commitment, bytes32[] calldata proof)
        internal
        pure
        returns (bool)
    {
        if (commitment.proofType == EvidenceProofType.SUMMARY_ONLY) {
            return proof.length == 0 && commitment.root == commitment.leafHash;
        }
        if (!isValidProofType(commitment.proofType)) {
            return false;
        }
        return verifyProof(commitment.leafHash, proof, commitment.root);
    }

    function hashSortedPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return uint256(a) <= uint256(b) ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
