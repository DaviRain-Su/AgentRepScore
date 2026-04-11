// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library ScoreConstants {
    int256 public constant MAX_SCORE = 10000;
    int256 public constant MIN_SCORE = -10000;
    int256 public constant BASE_AAVE_SCORE = 5000;
    int256 public constant BASE_UNISWAP_SCORE = 5000;
    int256 public constant BASE_ACTIVITY_SCORE = 4000;

    uint256 public constant HEALTH_FACTOR_SAFE = 2e18;
    uint256 public constant HEALTH_FACTOR_GOOD = 15e17;
    uint256 public constant HEALTH_FACTOR_MIN = 1e18;

    uint256 public constant COOLDOWN_DEFAULT = 1 days;
    uint256 public constant DATA_STALE_WINDOW = 7 days;
    uint256 public constant INACTIVITY_PENALTY_WINDOW = 30 days;
}
