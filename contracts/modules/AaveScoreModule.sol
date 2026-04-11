// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../ScoreConstants.sol";

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

    event LiquidationCountUpdated(address indexed wallet, uint256 liquidationCount, uint256 suppliedAssetCount);
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

    constructor(address aavePool_, address governance_) {
        aavePool = IPool(aavePool_);
        governance = governance_;
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

    function submitWalletMeta(address wallet, uint256 liquidationCount, uint256 suppliedAssetCount)
        external
        onlyKeeper
        whenNotPaused
    {
        walletMeta[wallet] = WalletMeta({
            liquidationCount: liquidationCount, suppliedAssetCount: suppliedAssetCount, timestamp: block.timestamp
        });
        emit LiquidationCountUpdated(wallet, liquidationCount, suppliedAssetCount);
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

        WalletMeta memory meta = walletMeta[wallet];
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
