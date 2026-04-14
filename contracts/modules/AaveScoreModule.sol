// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../interfaces/IEvidenceCommitment.sol";
import "../ScoreConstants.sol";
import "../lib/EvidenceCommitmentLib.sol";
import "../lib/EIP712Lib.sol";

interface IPool {
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

contract AaveScoreModule is IScoreModule {
    error UnauthorizedGovernance(address caller);
    error UnauthorizedKeeper(address caller);
    error CommitmentNotFound(address wallet);
    error SummaryNotFound(address wallet);
    error InvalidProofType(uint8 proofType);
    error SummaryHashMismatch(bytes32 expected, bytes32 actual);
    error LeafHashMismatch(bytes32 expected, bytes32 actual);
    error CommitmentProofInvalid();

    IPool public immutable aavePool;

    address public governance;
    address public pendingGovernance;
    mapping(address => bool) public keepers;

    struct WalletMeta {
        uint256 liquidationCount;
        uint256 suppliedAssetCount;
        uint256 timestamp;
    }

    mapping(address => WalletMeta) public walletMeta;
    mapping(address => IEvidenceCommitment.EvidenceCommitment) private latestWalletMetaCommitment;
    mapping(address => IEvidenceCommitment.EvidenceCommitmentAcceptance) private acceptedWalletMetaCommitment;
    mapping(address => WalletMeta) private acceptedWalletMeta;

    event LiquidationCountUpdated(
        address indexed wallet, uint256 liquidationCount, uint256 suppliedAssetCount, uint256 timestamp
    );
    event WalletMetaCommitmentSubmitted(
        address indexed wallet,
        bytes32 root,
        bytes32 leafHash,
        bytes32 summaryHash,
        uint64 epoch,
        uint64 blockNumber,
        uint8 proofType
    );
    event WalletMetaCommitmentAccepted(
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

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedGovernance(msg.sender);
        _;
    }

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
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

    bytes32 public constant WALLET_META_TYPEHASH = keccak256(
        "WalletMeta(address wallet,uint256 liquidationCount,uint256 suppliedAssetCount,uint256 timestamp,uint256 nonce)"
    );

    mapping(address => uint256) public nonces;
    bytes32 private immutable _domainSeparator;

    constructor(address aavePool_, address governance_) {
        aavePool = IPool(aavePool_);
        governance = governance_;
        _domainSeparator = EIP712Lib.domainSeparator("AaveScoreModule", "1", address(this));
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

    function submitWalletMeta(
        address wallet,
        uint256 liquidationCount,
        uint256 suppliedAssetCount,
        uint256 timestamp,
        bytes calldata signature
    ) external whenNotPaused {
        bytes32 structHash = keccak256(
            abi.encode(WALLET_META_TYPEHASH, wallet, liquidationCount, suppliedAssetCount, timestamp, nonces[wallet]++)
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(_domainSeparator, structHash);
        address signer = EIP712Lib.recoverSigner(digest, signature);
        if (!keepers[signer]) revert UnauthorizedKeeper(signer);

        walletMeta[wallet] = WalletMeta({
            liquidationCount: liquidationCount, suppliedAssetCount: suppliedAssetCount, timestamp: timestamp
        });
        emit LiquidationCountUpdated(wallet, liquidationCount, suppliedAssetCount, timestamp);
    }

    function submitWalletMetaCommitment(address wallet, IEvidenceCommitment.EvidenceCommitment calldata commitment)
        external
        onlyKeeper
        whenNotPaused
    {
        latestWalletMetaCommitment[wallet] = commitment;
        emit WalletMetaCommitmentSubmitted(
            wallet,
            commitment.root,
            commitment.leafHash,
            commitment.summaryHash,
            commitment.epoch,
            commitment.blockNumber,
            commitment.proofType
        );
    }

    function getLatestWalletMetaCommitment(address wallet)
        external
        view
        returns (IEvidenceCommitment.EvidenceCommitment memory)
    {
        return latestWalletMetaCommitment[wallet];
    }

    function acceptWalletMetaCommitment(address wallet, bytes32[] calldata proof) external onlyKeeper whenNotPaused {
        IEvidenceCommitment.EvidenceCommitment memory commitment = latestWalletMetaCommitment[wallet];
        if (commitment.summaryHash == bytes32(0)) revert CommitmentNotFound(wallet);

        if (!EvidenceCommitmentLib.isValidProofType(commitment.proofType)) {
            revert InvalidProofType(commitment.proofType);
        }

        WalletMeta memory summary = walletMeta[wallet];
        if (summary.timestamp == 0) revert SummaryNotFound(wallet);

        bytes32 expectedSummaryHash = _hashWalletMeta(summary);
        if (expectedSummaryHash != commitment.summaryHash) {
            revert SummaryHashMismatch(expectedSummaryHash, commitment.summaryHash);
        }

        bytes32 expectedLeafHash = EvidenceCommitmentLib.hashLeaf(
            "aave", wallet, commitment.epoch, commitment.blockNumber, commitment.summaryHash
        );
        if (expectedLeafHash != commitment.leafHash) {
            revert LeafHashMismatch(expectedLeafHash, commitment.leafHash);
        }

        if (!EvidenceCommitmentLib.verifyCommitment(commitment, proof)) {
            revert CommitmentProofInvalid();
        }

        uint64 verifiedAt = uint64(block.timestamp);
        acceptedWalletMetaCommitment[wallet] = IEvidenceCommitment.EvidenceCommitmentAcceptance({
            accepted: true,
            root: commitment.root,
            leafHash: commitment.leafHash,
            summaryHash: commitment.summaryHash,
            epoch: commitment.epoch,
            blockNumber: commitment.blockNumber,
            proofType: commitment.proofType,
            verifiedAt: verifiedAt
        });
        acceptedWalletMeta[wallet] = summary;

        emit WalletMetaCommitmentAccepted(
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

    function getAcceptedWalletMetaCommitment(address wallet)
        external
        view
        returns (IEvidenceCommitment.EvidenceCommitmentAcceptance memory)
    {
        return acceptedWalletMetaCommitment[wallet];
    }

    function _hashWalletMeta(WalletMeta memory summary) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(summary.liquidationCount, summary.suppliedAssetCount, summary.timestamp));
    }

    function _isAcceptedWalletMetaBindingValid(
        address wallet,
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted,
        WalletMeta memory summary
    ) private pure returns (bool) {
        if (!accepted.accepted || !EvidenceCommitmentLib.isValidProofType(accepted.proofType) || summary.timestamp == 0)
        {
            return false;
        }
        bytes32 summaryHash = _hashWalletMeta(summary);
        if (summaryHash != accepted.summaryHash) {
            return false;
        }
        bytes32 leafHash =
            EvidenceCommitmentLib.hashLeaf("aave", wallet, accepted.epoch, accepted.blockNumber, summaryHash);
        return leafHash == accepted.leafHash;
    }

    function _resolvePreferredWalletMeta(address wallet) private view returns (WalletMeta memory) {
        WalletMeta memory latest = walletMeta[wallet];
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted = acceptedWalletMetaCommitment[wallet];
        if (!accepted.accepted) {
            return latest;
        }

        WalletMeta memory verified = acceptedWalletMeta[wallet];
        if (!_isAcceptedWalletMetaBindingValid(wallet, accepted, verified)) {
            return latest;
        }

        return verified;
    }

    function name() external pure override returns (string memory) {
        return "AaveScoreModule";
    }

    function category() external pure override returns (string memory) {
        return "lending";
    }

    function metricNames() external pure override returns (string[] memory) {
        string[] memory metrics = new string[](4);
        metrics[0] = "healthFactor";
        metrics[1] = "liquidationCount";
        metrics[2] = "utilization";
        metrics[3] = "assetCount";
        return metrics;
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            /* availableBorrowsBase */,
            /* currentLiquidationThreshold */,
            /* ltv */,
            uint256 healthFactor
        ) = aavePool.getUserAccountData(wallet);

        if (totalCollateralBase == 0 && totalDebtBase == 0) {
            return (0, 0, bytes32(0));
        }

        score = ScoreConstants.BASE_AAVE_SCORE;

        if (healthFactor >= ScoreConstants.HEALTH_FACTOR_SAFE) {
            score += 2500;
        } else if (healthFactor >= ScoreConstants.HEALTH_FACTOR_GOOD) {
            score += 1500;
        } else if (healthFactor >= ScoreConstants.HEALTH_FACTOR_MIN) {
            score += 500;
        } else {
            score -= 3000;
        }

        WalletMeta memory meta = _resolvePreferredWalletMeta(wallet);
        uint256 liquidationCount = meta.liquidationCount;
        score -= int256(liquidationCount * 1500);

        uint256 utilization = 0;
        if (totalCollateralBase > 0) {
            utilization = totalDebtBase * 10000 / totalCollateralBase;
            if (utilization >= 3000 && utilization <= 7000) {
                score += 1000;
            } else if (utilization > 7000) {
                score -= 500;
            }
        }

        uint256 assetCount = meta.suppliedAssetCount;
        if (assetCount == 0) {
            assetCount = 1; // default if never submitted
        }
        if (assetCount >= 3) {
            score += 1000;
        } else if (assetCount >= 2) {
            score += 500;
        }

        if (score > ScoreConstants.MAX_SCORE) score = ScoreConstants.MAX_SCORE;
        if (score < ScoreConstants.MIN_SCORE) score = ScoreConstants.MIN_SCORE;

        confidence = 100;
        evidence = keccak256(abi.encodePacked(healthFactor, liquidationCount, utilization, assetCount));
    }
}
