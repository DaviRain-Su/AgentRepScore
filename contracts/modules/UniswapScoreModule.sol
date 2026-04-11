// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../ScoreConstants.sol";

contract UniswapScoreModule is IScoreModule {
    error UnauthorizedKeeper(address caller);
    error UnauthorizedGovernance(address caller);

    mapping(address => bool) public keepers;
    address public governance;
    address public pendingGovernance;

    struct SwapSummary {
        uint256 swapCount;
        uint256 volumeUSD;
        int256 netPnL;
        uint256 avgSlippageBps;
        uint256 feeToPnlRatioBps;
        bool washTradeFlag;
        uint256 timestamp;
        bytes32 evidenceHash;
    }

    mapping(address => SwapSummary) public latestSwapSummary;

    event SwapSummarySubmitted(
        address indexed wallet,
        uint256 swapCount,
        uint256 volumeUSD,
        int256 netPnL,
        bool washTradeFlag,
        bytes32 evidenceHash
    );
    event GovernanceTransferInitiated(address indexed previousGovernance, address indexed pendingGovernance);
    event GovernanceTransferAccepted(address indexed newGovernance);

    modifier onlyKeeper() {
        if (!keepers[msg.sender]) revert UnauthorizedKeeper(msg.sender);
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedGovernance(msg.sender);
        _;
    }

    constructor(address governance_) {
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

    function submitSwapSummary(address wallet, SwapSummary calldata summary) external onlyKeeper {
        latestSwapSummary[wallet] = summary;
        emit SwapSummarySubmitted(
            wallet, summary.swapCount, summary.volumeUSD, summary.netPnL, summary.washTradeFlag, summary.evidenceHash
        );
    }

    function name() external pure override returns (string memory) {
        return "UniswapScoreModule";
    }

    function category() external pure override returns (string memory) {
        return "dex";
    }

    function metricNames() external pure override returns (string[] memory) {
        string[] memory metrics = new string[](5);
        metrics[0] = "swapCount";
        metrics[1] = "volumeUSD";
        metrics[2] = "netPnL";
        metrics[3] = "avgSlippageBps";
        metrics[4] = "washTradeFlag";
        return metrics;
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        SwapSummary memory s = latestSwapSummary[wallet];

        if (s.swapCount == 0 || block.timestamp > s.timestamp + ScoreConstants.DATA_STALE_WINDOW) {
            return (0, 0, bytes32(0));
        }

        score = ScoreConstants.BASE_UNISWAP_SCORE;

        if (s.volumeUSD >= 100_000e6) {
            score += 1500;
        } else if (s.volumeUSD >= 10_000e6) {
            score += 800;
        } else if (s.volumeUSD >= 1_000e6) {
            score += 300;
        }

        if (s.netPnL > 0) {
            score += 1500;
        } else if (s.netPnL > -10_000e6) {
            score -= 500;
        } else {
            score -= 2000;
        }

        if (s.avgSlippageBps <= 10) {
            score += 1000;
        } else if (s.avgSlippageBps <= 50) {
            score += 500;
        } else {
            score -= 500;
        }

        if (s.washTradeFlag) {
            score -= 3000;
        }

        // Anti-gaming: fee-to-PnL ratio heuristic
        // If fees are disproportionately high relative to realized PnL, suggest wash-trading / MEV botting
        if (s.netPnL > 0 && s.feeToPnlRatioBps > 5000) {
            score -= 1500;
        } else if (s.netPnL <= 0 && s.feeToPnlRatioBps > 2000) {
            score -= 1500;
        }

        if (score > ScoreConstants.MAX_SCORE) score = ScoreConstants.MAX_SCORE;
        if (score < ScoreConstants.MIN_SCORE) score = ScoreConstants.MIN_SCORE;

        confidence = 100;
        evidence = s.evidenceHash;
    }
}
