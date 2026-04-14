// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";
import "../interfaces/IEvidenceCommitment.sol";
import "../ScoreConstants.sol";
import "../lib/EIP712Lib.sol";

interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

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
        bool counterpartyConcentrationFlag;
        uint256 timestamp;
        bytes32 evidenceHash;
        address pool;
    }

    mapping(address => SwapSummary) public latestSwapSummary;
    mapping(address => IEvidenceCommitment.EvidenceCommitment) private latestSwapCommitment;

    event SwapSummarySubmitted(
        address indexed wallet,
        uint256 swapCount,
        uint256 volumeUSD,
        int256 netPnL,
        bool washTradeFlag,
        bool counterpartyConcentrationFlag,
        bytes32 evidenceHash,
        address pool
    );
    event SwapCommitmentSubmitted(
        address indexed wallet,
        bytes32 root,
        bytes32 leafHash,
        bytes32 summaryHash,
        uint64 epoch,
        uint64 blockNumber,
        uint8 proofType
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

    bytes32 public constant SWAP_SUMMARY_TYPEHASH = keccak256(
        "SwapSummary(address wallet,uint256 swapCount,uint256 volumeUSD,int256 netPnL,uint256 avgSlippageBps,uint256 feeToPnlRatioBps,bool washTradeFlag,bool counterpartyConcentrationFlag,uint256 timestamp,bytes32 evidenceHash,address pool,uint256 nonce)"
    );

    mapping(address => uint160) public referenceSqrtPriceX96;
    uint256 public constant MAX_SQRT_PRICE_DEVIATION_BPS = 1000; // 10% sqrt deviation ≈ 21% price deviation

    error PriceDeviationTooHigh(address pool, uint160 current, uint160 ref);

    mapping(address => uint256) public nonces;
    bytes32 private immutable _domainSeparator;

    constructor(address governance_) {
        governance = governance_;
        _domainSeparator = EIP712Lib.domainSeparator("UniswapScoreModule", "1", address(this));
    }

    function setKeeper(address keeper, bool allowed) external onlyGovernance {
        keepers[keeper] = allowed;
    }

    function setReferenceSqrtPriceX96(address pool, uint160 sqrtPriceX96) external onlyGovernance {
        referenceSqrtPriceX96[pool] = sqrtPriceX96;
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

    function submitSwapSummary(address wallet, SwapSummary calldata summary, bytes calldata signature)
        external
        whenNotPaused
    {
        bytes32 structHash = keccak256(
            abi.encode(
                SWAP_SUMMARY_TYPEHASH,
                wallet,
                summary.swapCount,
                summary.volumeUSD,
                summary.netPnL,
                summary.avgSlippageBps,
                summary.feeToPnlRatioBps,
                summary.washTradeFlag,
                summary.counterpartyConcentrationFlag,
                summary.timestamp,
                summary.evidenceHash,
                summary.pool,
                nonces[wallet]++
            )
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(_domainSeparator, structHash);
        address signer = EIP712Lib.recoverSigner(digest, signature);
        if (!keepers[signer]) revert UnauthorizedKeeper(signer);

        latestSwapSummary[wallet] = summary;
        emit SwapSummarySubmitted(
            wallet,
            summary.swapCount,
            summary.volumeUSD,
            summary.netPnL,
            summary.washTradeFlag,
            summary.counterpartyConcentrationFlag,
            summary.evidenceHash,
            summary.pool
        );
    }

    function submitSwapCommitment(address wallet, IEvidenceCommitment.EvidenceCommitment calldata commitment)
        external
        onlyKeeper
        whenNotPaused
    {
        latestSwapCommitment[wallet] = commitment;
        emit SwapCommitmentSubmitted(
            wallet,
            commitment.root,
            commitment.leafHash,
            commitment.summaryHash,
            commitment.epoch,
            commitment.blockNumber,
            commitment.proofType
        );
    }

    function getLatestSwapCommitment(address wallet)
        external
        view
        returns (IEvidenceCommitment.EvidenceCommitment memory)
    {
        return latestSwapCommitment[wallet];
    }

    function name() external pure override returns (string memory) {
        return "UniswapScoreModule";
    }

    function category() external pure override returns (string memory) {
        return "dex";
    }

    function metricNames() external pure override returns (string[] memory) {
        string[] memory metrics = new string[](6);
        metrics[0] = "swapCount";
        metrics[1] = "volumeUSD";
        metrics[2] = "netPnL";
        metrics[3] = "avgSlippageBps";
        metrics[4] = "washTradeFlag";
        metrics[5] = "counterpartyConcentrationFlag";
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

        // Slot0 price sanity check
        if (s.pool != address(0)) {
            uint160 ref = referenceSqrtPriceX96[s.pool];
            if (ref != 0) {
                (uint160 currentSqrtPriceX96,,,,,,) = IUniswapV3Pool(s.pool).slot0();
                uint256 current = uint256(currentSqrtPriceX96);
                uint256 refPrice = uint256(ref);
                if (current > refPrice) {
                    if (current * 10000 > refPrice * (10000 + MAX_SQRT_PRICE_DEVIATION_BPS)) {
                        return (0, 0, bytes32(0));
                    }
                } else {
                    if (refPrice * 10000 > current * (10000 + MAX_SQRT_PRICE_DEVIATION_BPS)) {
                        return (0, 0, bytes32(0));
                    }
                }
            }
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

        if (s.counterpartyConcentrationFlag) {
            score -= 1500;
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
