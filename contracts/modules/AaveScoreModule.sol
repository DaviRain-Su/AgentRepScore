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
    IPool public immutable aavePool;

    constructor(address aavePool_) {
        aavePool = IPool(aavePool_);
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
            /* availableBorrowsBase */ ,
            /* currentLiquidationThreshold */ ,
            /* ltv */ ,
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

        // TODO: liquidation count needs off-chain indexer in MVP
        uint256 liquidationCount = 0;
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

        uint256 assetCount = _countSuppliedAssets(wallet);
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

    function _countSuppliedAssets(address /* wallet */) internal pure returns (uint256) {
        // MVP: Aave PoolDataProvider would be needed to count unique reserve balances > 0.
        // For hackathon MVP we return a default of 1 if the user has any collateral.
        return 1;
    }
}
