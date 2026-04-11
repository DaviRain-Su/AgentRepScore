// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../ScoreConstants.sol";

contract BaseActivityModule is IScoreModule {
    error UnauthorizedKeeper(address caller);

    mapping(address => bool) public keepers;
    address public governance;

    struct ActivitySummary {
        uint256 txCount;
        uint256 firstTxTimestamp;
        uint256 lastTxTimestamp;
        uint256 uniqueCounterparties;
        uint256 timestamp;
        bytes32 evidenceHash;
    }

    mapping(address => ActivitySummary) public latestActivitySummary;

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "UnauthorizedGovernance");
        _;
    }

    constructor(address governance_) {
        governance = governance_;
    }

    function setKeeper(address keeper, bool allowed) external onlyGovernance {
        keepers[keeper] = allowed;
    }

    function submitActivitySummary(address wallet, ActivitySummary calldata summary) external onlyKeeper {
        latestActivitySummary[wallet] = summary;
    }

    function name() external pure override returns (string memory) {
        return "BaseActivityModule";
    }

    function category() external pure override returns (string memory) {
        return "activity";
    }

    function metricNames() external pure override returns (string[] memory) {
        string[] memory metrics = new string[](4);
        metrics[0] = "txCount";
        metrics[1] = "walletAgeDays";
        metrics[2] = "uniqueCounterparties";
        metrics[3] = "daysSinceLastTx";
        return metrics;
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        ActivitySummary memory s = latestActivitySummary[wallet];

        if (s.txCount == 0 || block.timestamp > s.timestamp + ScoreConstants.DATA_STALE_WINDOW) {
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

        if (score > ScoreConstants.MAX_SCORE) score = ScoreConstants.MAX_SCORE;
        if (score < ScoreConstants.MIN_SCORE) score = ScoreConstants.MIN_SCORE;

        confidence = 100;
        evidence = s.evidenceHash;
    }
}
