// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../interfaces/IEvidenceCommitment.sol";
import "../ScoreConstants.sol";
import "../lib/EvidenceCommitmentLib.sol";
import "../lib/EIP712Lib.sol";

contract BaseActivityModule is IScoreModule {
    error UnauthorizedKeeper(address caller);
    error UnauthorizedGovernance(address caller);
    error CommitmentNotFound(address wallet);
    error SummaryNotFound(address wallet);
    error InvalidProofType(uint8 proofType);
    error SummaryHashMismatch(bytes32 expected, bytes32 actual);
    error LeafHashMismatch(bytes32 expected, bytes32 actual);
    error CommitmentProofInvalid();

    mapping(address => bool) public keepers;
    address public governance;
    address public pendingGovernance;

    struct ActivitySummary {
        uint256 txCount;
        uint256 firstTxTimestamp;
        uint256 lastTxTimestamp;
        uint256 uniqueCounterparties;
        uint256 timestamp;
        bytes32 evidenceHash;
        bool sybilClusterFlag;
    }

    mapping(address => ActivitySummary) public latestActivitySummary;
    mapping(address => IEvidenceCommitment.EvidenceCommitment) private latestActivityCommitment;
    mapping(address => IEvidenceCommitment.EvidenceCommitmentAcceptance) private acceptedActivityCommitment;
    mapping(address => ActivitySummary) private acceptedActivitySummary;

    event ActivitySummarySubmitted(
        address indexed wallet,
        uint256 txCount,
        uint256 uniqueCounterparties,
        bytes32 evidenceHash,
        bool sybilClusterFlag
    );
    event ActivityCommitmentSubmitted(
        address indexed wallet,
        bytes32 root,
        bytes32 leafHash,
        bytes32 summaryHash,
        uint64 epoch,
        uint64 blockNumber,
        uint8 proofType
    );
    event ActivityCommitmentAccepted(
        address indexed wallet,
        bytes32 root,
        bytes32 leafHash,
        bytes32 summaryHash,
        uint64 epoch,
        uint64 blockNumber,
        uint8 proofType,
        uint64 verifiedAt
    );
    event GovernanceTransferInitiated(address indexed previousGovernance, address indexed pendingGovernance);
    event GovernanceTransferAccepted(address indexed newGovernance);

    bool public paused;
    error ContractPaused();
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedGovernance(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    function pause() external onlyGovernance {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGovernance {
        paused = false;
        emit Unpaused(msg.sender);
    }

    bytes32 public constant ACTIVITY_SUMMARY_TYPEHASH = keccak256(
        "ActivitySummary(address wallet,uint256 txCount,uint256 firstTxTimestamp,uint256 lastTxTimestamp,uint256 uniqueCounterparties,uint256 timestamp,bytes32 evidenceHash,bool sybilClusterFlag,uint256 nonce)"
    );

    mapping(address => uint256) public nonces;
    bytes32 private immutable _domainSeparator;

    constructor(address governance_) {
        governance = governance_;
        _domainSeparator = EIP712Lib.domainSeparator("BaseActivityModule", "1", address(this));
    }

    function setKeeper(address keeper, bool allowed) external onlyGovernance {
        keepers[keeper] = allowed;
    }

    function initiateGovernanceTransfer(address newGovernance) external onlyGovernance {
        pendingGovernance = newGovernance;
        emit GovernanceTransferInitiated(governance, newGovernance);
    }

    function acceptGovernanceTransfer() external {
        if (msg.sender != pendingGovernance) revert UnauthorizedGovernance(msg.sender);
        governance = pendingGovernance;
        pendingGovernance = address(0);
        emit GovernanceTransferAccepted(governance);
    }

    function submitActivitySummary(address wallet, ActivitySummary calldata summary, bytes calldata signature)
        external
        whenNotPaused
    {
        bytes32 structHash = keccak256(
            abi.encode(
                ACTIVITY_SUMMARY_TYPEHASH,
                wallet,
                summary.txCount,
                summary.firstTxTimestamp,
                summary.lastTxTimestamp,
                summary.uniqueCounterparties,
                summary.timestamp,
                summary.evidenceHash,
                summary.sybilClusterFlag,
                nonces[wallet]++
            )
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(_domainSeparator, structHash);
        address signer = EIP712Lib.recoverSigner(digest, signature);
        if (!keepers[signer]) revert UnauthorizedKeeper(signer);

        latestActivitySummary[wallet] = summary;
        emit ActivitySummarySubmitted(
            wallet, summary.txCount, summary.uniqueCounterparties, summary.evidenceHash, summary.sybilClusterFlag
        );
    }

    function submitActivityCommitment(address wallet, IEvidenceCommitment.EvidenceCommitment calldata commitment)
        external
        onlyKeeper
        whenNotPaused
    {
        latestActivityCommitment[wallet] = commitment;
        emit ActivityCommitmentSubmitted(
            wallet,
            commitment.root,
            commitment.leafHash,
            commitment.summaryHash,
            commitment.epoch,
            commitment.blockNumber,
            commitment.proofType
        );
    }

    function getLatestActivityCommitment(address wallet)
        external
        view
        returns (IEvidenceCommitment.EvidenceCommitment memory)
    {
        return latestActivityCommitment[wallet];
    }

    function acceptActivityCommitment(address wallet, bytes32[] calldata proof) external onlyKeeper whenNotPaused {
        IEvidenceCommitment.EvidenceCommitment memory commitment = latestActivityCommitment[wallet];
        if (commitment.summaryHash == bytes32(0)) revert CommitmentNotFound(wallet);

        if (!EvidenceCommitmentLib.isValidProofType(commitment.proofType)) {
            revert InvalidProofType(commitment.proofType);
        }

        ActivitySummary memory summary = latestActivitySummary[wallet];
        if (summary.timestamp == 0) revert SummaryNotFound(wallet);

        bytes32 expectedSummaryHash = _hashActivitySummary(summary);
        if (expectedSummaryHash != commitment.summaryHash) {
            revert SummaryHashMismatch(expectedSummaryHash, commitment.summaryHash);
        }

        bytes32 expectedLeafHash = EvidenceCommitmentLib.hashLeaf(
            "activity", wallet, commitment.epoch, commitment.blockNumber, commitment.summaryHash
        );
        if (expectedLeafHash != commitment.leafHash) {
            revert LeafHashMismatch(expectedLeafHash, commitment.leafHash);
        }

        if (!EvidenceCommitmentLib.verifyCommitment(commitment, proof)) {
            revert CommitmentProofInvalid();
        }

        uint64 verifiedAt = uint64(block.timestamp);
        acceptedActivityCommitment[wallet] = IEvidenceCommitment.EvidenceCommitmentAcceptance({
            accepted: true,
            root: commitment.root,
            leafHash: commitment.leafHash,
            summaryHash: commitment.summaryHash,
            epoch: commitment.epoch,
            blockNumber: commitment.blockNumber,
            proofType: commitment.proofType,
            verifiedAt: verifiedAt
        });
        acceptedActivitySummary[wallet] = summary;

        emit ActivityCommitmentAccepted(
            wallet,
            commitment.root,
            commitment.leafHash,
            commitment.summaryHash,
            commitment.epoch,
            commitment.blockNumber,
            commitment.proofType,
            verifiedAt
        );
    }

    function getAcceptedActivityCommitment(address wallet)
        external
        view
        returns (IEvidenceCommitment.EvidenceCommitmentAcceptance memory)
    {
        return acceptedActivityCommitment[wallet];
    }

    function _hashActivitySummary(ActivitySummary memory summary) private pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                summary.txCount,
                summary.firstTxTimestamp,
                summary.lastTxTimestamp,
                summary.uniqueCounterparties,
                summary.timestamp,
                summary.evidenceHash,
                summary.sybilClusterFlag
            )
        );
    }

    function _isActivitySummaryEvaluable(ActivitySummary memory summary) private view returns (bool) {
        return summary.txCount != 0 && block.timestamp <= summary.timestamp + ScoreConstants.DATA_STALE_WINDOW;
    }

    function _isAcceptedActivityBindingValid(
        address wallet,
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted,
        ActivitySummary memory summary
    ) private pure returns (bool) {
        if (!accepted.accepted || !EvidenceCommitmentLib.isValidProofType(accepted.proofType) || summary.timestamp == 0)
        {
            return false;
        }
        bytes32 summaryHash = _hashActivitySummary(summary);
        if (summaryHash != accepted.summaryHash) {
            return false;
        }
        bytes32 leafHash =
            EvidenceCommitmentLib.hashLeaf("activity", wallet, accepted.epoch, accepted.blockNumber, summaryHash);
        return leafHash == accepted.leafHash;
    }

    function _resolvePreferredActivitySummary(address wallet) private view returns (ActivitySummary memory) {
        ActivitySummary memory latest = latestActivitySummary[wallet];
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted = acceptedActivityCommitment[wallet];
        if (!accepted.accepted) {
            return latest;
        }

        ActivitySummary memory verified = acceptedActivitySummary[wallet];
        if (!_isAcceptedActivityBindingValid(wallet, accepted, verified)) {
            return latest;
        }

        if (!_isActivitySummaryEvaluable(verified)) {
            return latest;
        }

        return verified;
    }

    function name() external pure override returns (string memory) {
        return "BaseActivityModule";
    }

    function category() external pure override returns (string memory) {
        return "activity";
    }

    function metricNames() external pure override returns (string[] memory) {
        string[] memory metrics = new string[](5);
        metrics[0] = "txCount";
        metrics[1] = "walletAgeDays";
        metrics[2] = "uniqueCounterparties";
        metrics[3] = "daysSinceLastTx";
        metrics[4] = "sybilClusterFlag";
        return metrics;
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        ActivitySummary memory s = _resolvePreferredActivitySummary(wallet);
        if (!_isActivitySummaryEvaluable(s)) {
            return (0, 0, bytes32(0));
        }

        uint256 walletAgeDays = (block.timestamp - s.firstTxTimestamp) / 1 days;
        uint256 uniqueCounterparties = s.uniqueCounterparties;

        score = ScoreConstants.BASE_ACTIVITY_SCORE;

        if (walletAgeDays >= 365) {
            score += 1500;
        } else if (walletAgeDays >= 90) {
            score += 800;
        } else if (walletAgeDays >= 30) {
            score += 300;
        }

        if (s.txCount >= 1000) {
            score += 1500;
        } else if (s.txCount >= 100) {
            score += 800;
        } else if (s.txCount >= 10) {
            score += 300;
        }

        if (uniqueCounterparties >= 50) {
            score += 1500;
        } else if (uniqueCounterparties >= 10) {
            score += 800;
        } else if (uniqueCounterparties >= 3) {
            score += 300;
        } else {
            score -= 1000;
        }

        uint256 daysSinceLastTx = (block.timestamp - s.lastTxTimestamp) / 1 days;
        if (daysSinceLastTx > 30) {
            score -= int256((daysSinceLastTx / 30) * 500);
        }

        if (s.sybilClusterFlag) {
            score -= 2000;
        }

        if (score > ScoreConstants.MAX_SCORE) score = ScoreConstants.MAX_SCORE;
        if (score < ScoreConstants.MIN_SCORE) score = ScoreConstants.MIN_SCORE;

        confidence = 100;
        evidence = s.evidenceHash;
    }
}
