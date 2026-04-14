// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IScoreModule.sol";
import "./interfaces/IERC8004.sol";
import "./ScoreConstants.sol";

interface IUniswapCorrelationView {
    function latestSwapSummary(address wallet)
        external
        view
        returns (
            uint256 swapCount,
            uint256 volumeUSD,
            int256 netPnL,
            uint256 avgSlippageBps,
            uint256 feeToPnlRatioBps,
            bool washTradeFlag,
            bool counterpartyConcentrationFlag,
            uint256 timestamp,
            bytes32 evidenceHash,
            address pool
        );
}

interface IBaseActivityCorrelationView {
    function latestActivitySummary(address wallet)
        external
        view
        returns (
            uint256 txCount,
            uint256 firstTxTimestamp,
            uint256 lastTxTimestamp,
            uint256 uniqueCounterparties,
            uint256 timestamp,
            bytes32 evidenceHash,
            bool sybilClusterFlag
        );
}

interface IAaveCorrelationView {
    function walletMeta(address wallet)
        external
        view
        returns (uint256 liquidationCount, uint256 suppliedAssetCount, uint256 timestamp);
}

contract AgentRepValidatorV2 is Initializable, UUPSUpgradeable {
    // ERC-8004 registries (set once in initialize, not immutable for proxy compat)
    address public identityRegistry;
    address public reputationRegistry;
    address public validationRegistry;

    mapping(bytes32 => bool) public validationHandled;

    address public governance;

    struct ModuleConfig {
        IScoreModule module;
        uint256 weight;
        bool active;
    }

    ModuleConfig[] public modules;

    struct AgentScore {
        int256 score;
        uint256 timestamp;
        bytes32 evidenceHash;
        uint256 confidence;
    }

    mapping(uint256 => AgentScore) public agentScores;
    mapping(uint256 => mapping(uint256 => AgentScore)) public moduleScores;

    uint256 public evaluationCooldown;
    mapping(uint256 => uint256) public lastEvaluationTime;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    bool public paused;
    error ContractPaused();
    error ContractNotPaused();
    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    function pause() external onlyGovernance {
        if (paused) revert ContractPaused();
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyGovernance {
        if (!paused) revert ContractNotPaused();
        paused = false;
        emit Unpaused(msg.sender);
    }

    // Timelock
    uint256 public constant TIMELOCK_DELAY = 24 hours;

    struct TimelockOp {
        bytes32 opHash;
        uint256 readyAt;
        bool executed;
    }

    mapping(bytes32 => TimelockOp) public timelockOps;

    error TimelockNotReady(bytes32 opHash, uint256 readyAt);
    error TimelockNotScheduled(bytes32 opHash);
    error TimelockAlreadyExecuted(bytes32 opHash);
    event TimelockScheduled(bytes32 indexed opHash, uint256 readyAt);
    event TimelockExecuted(bytes32 indexed opHash);
    event TimelockCancelled(bytes32 indexed opHash);
    error TimelockParamMismatch(bytes32 expected, bytes32 actual);

    mapping(address => bool) public evaluators;

    modifier onlyEvaluator() {
        if (msg.sender != governance && !evaluators[msg.sender]) revert UnauthorizedEvaluator(msg.sender);
        _;
    }

    address public pendingGovernance;
    uint256 public bootstrapDeadline;

    struct WeightPolicy {
        bool enabled;
        uint16 minWeightBps;
        uint16 decayStepBps;
        uint16 recoveryStepBps;
        uint8 zeroConfidenceThreshold;
    }

    struct ModuleRuntimeState {
        uint256 zeroConfidenceStreak;
        uint256 effectiveBaseWeight;
        uint256 lastUpdatedAt;
    }

    struct CorrelationAssessment {
        int256 penalty;
        bytes32 evidenceHash;
        uint8 ruleCount;
        uint256 timestamp;
    }

    struct CorrelationPolicy {
        bool enabled;
        bool washSybilEnabled;
        bool concentrationLowCounterpartiesEnabled;
        bool youngWalletHighVolumeEnabled;
        uint256 highSwapThreshold;
        uint256 lowCounterpartiesThreshold;
        uint256 highVolumeThreshold;
        uint256 youngWalletDaysThreshold;
        uint256 penaltyWashSybil;
        uint256 penaltyConcentrationLowCounterparties;
        uint256 penaltyYoungWalletHighVolume;
        uint256 maxPenalty;
    }

    struct CorrelationSignalContext {
        bool hasUniswap;
        bool hasActivity;
        bool hasAave;
        bool washTradeFlag;
        bool counterpartyConcentrationFlag;
        bool sybilClusterFlag;
        uint256 swapCount;
        uint256 volumeUSD;
        uint256 uniqueCounterparties;
        uint256 walletAgeDays;
        uint256 aaveLiquidationCount;
        uint256 aaveSuppliedAssetCount;
        bytes32 uniswapEvidenceHash;
        bytes32 activityEvidenceHash;
        bytes32 aaveEvidenceHash;
    }

    mapping(uint256 => uint256) public consecutiveZeroConfidence;
    uint256 public autoDeactivateThreshold;

    WeightPolicy public weightPolicy;
    CorrelationPolicy public correlationPolicy;
    mapping(uint256 => ModuleRuntimeState) private moduleRuntimeStates;
    mapping(uint256 => CorrelationAssessment) private correlationAssessments;

    bytes32 private constant _UNISWAP_MODULE_HASH = keccak256("UniswapScoreModule");
    bytes32 private constant _BASE_ACTIVITY_MODULE_HASH = keccak256("BaseActivityModule");
    bytes32 private constant _AAVE_MODULE_HASH = keccak256("AaveScoreModule");

    // Custom errors
    error CooldownNotElapsed(uint256 remaining);
    error AgentWalletNotSet(uint256 agentId);
    error ModuleIndexOutOfBounds(uint256 index);
    error UnauthorizedGovernance(address caller);
    error UnauthorizedEvaluator(address caller);
    error TotalWeightExceeded(uint256 totalWeight);
    error ValidationAlreadyHandled(bytes32 requestHash);
    error ValidationRequestNotFound(bytes32 requestHash);
    error BootstrapExpired();
    error InvalidWeightPolicy(uint16 minWeightBps, uint16 decayStepBps, uint16 recoveryStepBps);
    error ThresholdOutOfRange(uint256 threshold);
    error InvalidCorrelationPolicy();

    // Events
    event ModuleRegistered(address indexed module, uint256 weight);
    event ModuleUpdated(uint256 indexed index, uint256 newWeight, bool active);
    event AgentEvaluated(
        uint256 indexed agentId, int256 score, int128 normalizedScore, uint8 valueDecimals, bytes32 evidenceHash
    );
    event WeightPolicyUpdated(
        bool enabled, uint16 minWeightBps, uint16 decayStepBps, uint16 recoveryStepBps, uint8 zeroConfidenceThreshold
    );
    event CorrelationPolicyUpdated(
        bool enabled,
        bool washSybilEnabled,
        bool concentrationLowCounterpartiesEnabled,
        bool youngWalletHighVolumeEnabled,
        uint256 highSwapThreshold,
        uint256 lowCounterpartiesThreshold,
        uint256 highVolumeThreshold,
        uint256 youngWalletDaysThreshold,
        uint256 penaltyWashSybil,
        uint256 penaltyConcentrationLowCounterparties,
        uint256 penaltyYoungWalletHighVolume,
        uint256 maxPenalty
    );
    event CorrelationPenaltyApplied(uint256 indexed agentId, int256 penalty, bytes32 evidenceHash, uint8 ruleCount);
    event ValidationResponded(bytes32 indexed requestHash, uint256 indexed agentId, int256 score, bytes32 evidenceHash);
    event EvaluatorSet(address indexed evaluator, bool allowed);
    event GovernanceTransferInitiated(address indexed previousGovernance, address indexed pendingGovernance);
    event GovernanceTransferAccepted(address indexed newGovernance);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedGovernance(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address identityRegistry_,
        address reputationRegistry_,
        address validationRegistry_,
        address governance_
    ) public initializer {
        identityRegistry = identityRegistry_;
        reputationRegistry = reputationRegistry_;
        validationRegistry = validationRegistry_;
        governance = governance_;
        evaluators[governance_] = true;
        evaluationCooldown = ScoreConstants.COOLDOWN_DEFAULT;
        bootstrapDeadline = block.timestamp + 1 hours;
        weightPolicy = WeightPolicy({
            enabled: true, minWeightBps: 2000, decayStepBps: 500, recoveryStepBps: 250, zeroConfidenceThreshold: 3
        });
        correlationPolicy = CorrelationPolicy({
            enabled: true,
            washSybilEnabled: true,
            concentrationLowCounterpartiesEnabled: true,
            youngWalletHighVolumeEnabled: true,
            highSwapThreshold: 50,
            lowCounterpartiesThreshold: 2,
            highVolumeThreshold: 100_000e6,
            youngWalletDaysThreshold: 14,
            penaltyWashSybil: 2500,
            penaltyConcentrationLowCounterparties: 1200,
            penaltyYoungWalletHighVolume: 1000,
            maxPenalty: 5000
        });
        autoDeactivateThreshold = weightPolicy.zeroConfidenceThreshold;
        _status = _NOT_ENTERED;
    }

    function _authorizeUpgrade(address) internal override onlyGovernance {}

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    // --- Timelock operations ---

    function scheduleRegisterModule(IScoreModule module, uint256 weight) external onlyGovernance returns (bytes32) {
        bytes32 opHash = keccak256(abi.encode("registerModule", module, weight));
        timelockOps[opHash] = TimelockOp({opHash: opHash, readyAt: block.timestamp + TIMELOCK_DELAY, executed: false});
        emit TimelockScheduled(opHash, block.timestamp + TIMELOCK_DELAY);
        return opHash;
    }

    function executeRegisterModule(IScoreModule module, uint256 weight) external onlyGovernance {
        bytes32 opHash = keccak256(abi.encode("registerModule", module, weight));
        _validateTimelock(opHash);
        uint256 totalWeight = _totalActiveWeight();
        if (totalWeight + weight > 10000) revert TotalWeightExceeded(totalWeight + weight);
        modules.push(ModuleConfig({module: module, weight: weight, active: true}));
        _resetModuleRuntimeState(modules.length - 1, weight);
        emit ModuleRegistered(address(module), weight);
    }

    function scheduleUpdateWeight(uint256 moduleIndex, uint256 newWeight) external onlyGovernance returns (bytes32) {
        bytes32 opHash = keccak256(abi.encode("updateWeight", moduleIndex, newWeight));
        timelockOps[opHash] = TimelockOp({opHash: opHash, readyAt: block.timestamp + TIMELOCK_DELAY, executed: false});
        emit TimelockScheduled(opHash, block.timestamp + TIMELOCK_DELAY);
        return opHash;
    }

    function executeUpdateWeight(uint256 moduleIndex, uint256 newWeight) external onlyGovernance {
        bytes32 opHash = keccak256(abi.encode("updateWeight", moduleIndex, newWeight));
        _validateTimelock(opHash);
        if (moduleIndex >= modules.length) revert ModuleIndexOutOfBounds(moduleIndex);
        modules[moduleIndex].weight = newWeight;
        _resetModuleRuntimeState(moduleIndex, newWeight);
        uint256 totalWeight = _totalActiveWeight();
        if (totalWeight > 10000) revert TotalWeightExceeded(totalWeight);
        emit ModuleUpdated(moduleIndex, newWeight, modules[moduleIndex].active);
    }

    function cancelTimelock(bytes32 opHash) external onlyGovernance {
        if (timelockOps[opHash].readyAt == 0) revert TimelockNotScheduled(opHash);
        delete timelockOps[opHash];
        emit TimelockCancelled(opHash);
    }

    function _validateTimelock(bytes32 opHash) internal {
        TimelockOp storage op = timelockOps[opHash];
        if (op.readyAt == 0) revert TimelockNotScheduled(opHash);
        if (op.executed) revert TimelockAlreadyExecuted(opHash);
        if (block.timestamp < op.readyAt) revert TimelockNotReady(opHash, op.readyAt);
        op.executed = true;
        emit TimelockExecuted(opHash);
    }

    // --- Governance ---

    function setEvaluator(address evaluator, bool allowed) external onlyGovernance whenNotPaused {
        evaluators[evaluator] = allowed;
        emit EvaluatorSet(evaluator, allowed);
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

    // --- Module management ---

    function bootstrapModules(IScoreModule[] calldata moduleList, uint256[] calldata weights)
        external
        onlyGovernance
        whenNotPaused
    {
        if (block.timestamp > bootstrapDeadline) revert BootstrapExpired();
        if (moduleList.length != weights.length) revert ModuleIndexOutOfBounds(moduleList.length);
        for (uint256 i = 0; i < moduleList.length; i++) {
            uint256 totalWeight = _totalActiveWeight();
            if (totalWeight + weights[i] > 10000) revert TotalWeightExceeded(totalWeight + weights[i]);
            modules.push(ModuleConfig({module: moduleList[i], weight: weights[i], active: true}));
            _resetModuleRuntimeState(modules.length - 1, weights[i]);
            emit ModuleRegistered(address(moduleList[i]), weights[i]);
        }
    }

    function _totalActiveWeight() internal view returns (uint256 totalWeight) {
        for (uint256 i = 0; i < modules.length; i++) {
            if (modules[i].active) {
                totalWeight += modules[i].weight;
            }
        }
    }

    function setModuleActive(uint256 moduleIndex, bool active) external onlyGovernance whenNotPaused {
        if (moduleIndex >= modules.length) revert ModuleIndexOutOfBounds(moduleIndex);
        modules[moduleIndex].active = active;
        if (active) {
            _resetModuleRuntimeState(moduleIndex, modules[moduleIndex].weight);
            uint256 totalWeight = _totalActiveWeight();
            if (totalWeight > 10000) revert TotalWeightExceeded(totalWeight);
        } else {
            moduleRuntimeStates[moduleIndex].lastUpdatedAt = block.timestamp;
        }
        emit ModuleUpdated(moduleIndex, modules[moduleIndex].weight, active);
    }

    function setCooldown(uint256 cooldown) external onlyGovernance whenNotPaused {
        evaluationCooldown = cooldown;
    }

    function setAutoDeactivateThreshold(uint256 threshold) external onlyGovernance whenNotPaused {
        if (threshold > type(uint8).max) revert ThresholdOutOfRange(threshold);
        weightPolicy.zeroConfidenceThreshold = uint8(threshold);
        autoDeactivateThreshold = threshold;
        emit WeightPolicyUpdated(
            weightPolicy.enabled,
            weightPolicy.minWeightBps,
            weightPolicy.decayStepBps,
            weightPolicy.recoveryStepBps,
            weightPolicy.zeroConfidenceThreshold
        );
    }

    function setWeightPolicy(
        bool enabled,
        uint16 minWeightBps,
        uint16 decayStepBps,
        uint16 recoveryStepBps,
        uint8 zeroConfidenceThreshold
    ) external onlyGovernance whenNotPaused {
        if (minWeightBps > 10000 || decayStepBps > 10000 || recoveryStepBps > 10000) {
            revert InvalidWeightPolicy(minWeightBps, decayStepBps, recoveryStepBps);
        }

        weightPolicy = WeightPolicy({
            enabled: enabled,
            minWeightBps: minWeightBps,
            decayStepBps: decayStepBps,
            recoveryStepBps: recoveryStepBps,
            zeroConfidenceThreshold: zeroConfidenceThreshold
        });
        autoDeactivateThreshold = zeroConfidenceThreshold;

        for (uint256 i = 0; i < modules.length; i++) {
            ModuleRuntimeState storage runtime = moduleRuntimeStates[i];
            runtime.lastUpdatedAt = block.timestamp;
            if (!enabled) {
                runtime.zeroConfidenceStreak = 0;
                runtime.effectiveBaseWeight = modules[i].weight;
                consecutiveZeroConfidence[i] = 0;
                continue;
            }

            if (runtime.effectiveBaseWeight == 0 && modules[i].weight > 0) {
                runtime.effectiveBaseWeight = modules[i].weight;
            }
            uint256 minWeight = _minAdaptiveWeight(modules[i].weight);
            if (runtime.effectiveBaseWeight < minWeight) {
                runtime.effectiveBaseWeight = minWeight;
            }
            if (runtime.effectiveBaseWeight > modules[i].weight) {
                runtime.effectiveBaseWeight = modules[i].weight;
            }
            consecutiveZeroConfidence[i] = runtime.zeroConfidenceStreak;
        }

        emit WeightPolicyUpdated(enabled, minWeightBps, decayStepBps, recoveryStepBps, zeroConfidenceThreshold);
    }

    function getWeightPolicy()
        external
        view
        returns (
            bool enabled,
            uint16 minWeightBps,
            uint16 decayStepBps,
            uint16 recoveryStepBps,
            uint8 zeroConfidenceThreshold
        )
    {
        WeightPolicy memory policy = weightPolicy;
        return (
            policy.enabled,
            policy.minWeightBps,
            policy.decayStepBps,
            policy.recoveryStepBps,
            policy.zeroConfidenceThreshold
        );
    }

    function setCorrelationPolicy(
        bool enabled,
        bool washSybilEnabled,
        bool concentrationLowCounterpartiesEnabled,
        bool youngWalletHighVolumeEnabled,
        uint256 highSwapThreshold,
        uint256 lowCounterpartiesThreshold,
        uint256 highVolumeThreshold,
        uint256 youngWalletDaysThreshold,
        uint256 penaltyWashSybil,
        uint256 penaltyConcentrationLowCounterparties,
        uint256 penaltyYoungWalletHighVolume,
        uint256 maxPenalty
    ) external onlyGovernance whenNotPaused {
        uint256 maxAllowedPenalty = uint256(ScoreConstants.MAX_SCORE);
        if (maxPenalty > maxAllowedPenalty) revert InvalidCorrelationPolicy();
        if (
            penaltyWashSybil > maxPenalty || penaltyConcentrationLowCounterparties > maxPenalty
                || penaltyYoungWalletHighVolume > maxPenalty
        ) {
            revert InvalidCorrelationPolicy();
        }

        correlationPolicy = CorrelationPolicy({
            enabled: enabled,
            washSybilEnabled: washSybilEnabled,
            concentrationLowCounterpartiesEnabled: concentrationLowCounterpartiesEnabled,
            youngWalletHighVolumeEnabled: youngWalletHighVolumeEnabled,
            highSwapThreshold: highSwapThreshold,
            lowCounterpartiesThreshold: lowCounterpartiesThreshold,
            highVolumeThreshold: highVolumeThreshold,
            youngWalletDaysThreshold: youngWalletDaysThreshold,
            penaltyWashSybil: penaltyWashSybil,
            penaltyConcentrationLowCounterparties: penaltyConcentrationLowCounterparties,
            penaltyYoungWalletHighVolume: penaltyYoungWalletHighVolume,
            maxPenalty: maxPenalty
        });

        emit CorrelationPolicyUpdated(
            enabled,
            washSybilEnabled,
            concentrationLowCounterpartiesEnabled,
            youngWalletHighVolumeEnabled,
            highSwapThreshold,
            lowCounterpartiesThreshold,
            highVolumeThreshold,
            youngWalletDaysThreshold,
            penaltyWashSybil,
            penaltyConcentrationLowCounterparties,
            penaltyYoungWalletHighVolume,
            maxPenalty
        );
    }

    function getCorrelationPolicy()
        external
        view
        returns (
            bool enabled,
            bool washSybilEnabled,
            bool concentrationLowCounterpartiesEnabled,
            bool youngWalletHighVolumeEnabled,
            uint256 highSwapThreshold,
            uint256 lowCounterpartiesThreshold,
            uint256 highVolumeThreshold,
            uint256 youngWalletDaysThreshold,
            uint256 penaltyWashSybil,
            uint256 penaltyConcentrationLowCounterparties,
            uint256 penaltyYoungWalletHighVolume,
            uint256 maxPenalty
        )
    {
        CorrelationPolicy memory policy = correlationPolicy;
        return (
            policy.enabled,
            policy.washSybilEnabled,
            policy.concentrationLowCounterpartiesEnabled,
            policy.youngWalletHighVolumeEnabled,
            policy.highSwapThreshold,
            policy.lowCounterpartiesThreshold,
            policy.highVolumeThreshold,
            policy.youngWalletDaysThreshold,
            policy.penaltyWashSybil,
            policy.penaltyConcentrationLowCounterparties,
            policy.penaltyYoungWalletHighVolume,
            policy.maxPenalty
        );
    }

    function moduleCount() external view returns (uint256) {
        return modules.length;
    }

    // --- Evaluation ---

    function handleValidationRequest(bytes32 requestHash, uint256 agentId)
        external
        onlyEvaluator
        nonReentrant
        whenNotPaused
    {
        if (validationHandled[requestHash]) revert ValidationAlreadyHandled(requestHash);
        if (validationRegistry != address(0)) {
            bool exists = IValidationRegistry(validationRegistry).validationRequestExists(requestHash);
            if (!exists) revert ValidationRequestNotFound(requestHash);
        }
        validationHandled[requestHash] = true;
        (int256 score, bytes32 evidenceHash) = _evaluateAgent(agentId);
        emit ValidationResponded(requestHash, agentId, score, evidenceHash);
    }

    function evaluateAgent(uint256 agentId)
        public
        onlyEvaluator
        nonReentrant
        whenNotPaused
        returns (int256 score, bytes32 evidenceHash)
    {
        return _evaluateAgent(agentId);
    }

    function _evaluateAgent(uint256 agentId) internal returns (int256 score, bytes32 evidenceHash) {
        if (block.timestamp < lastEvaluationTime[agentId] + evaluationCooldown) {
            revert CooldownNotElapsed(lastEvaluationTime[agentId] + evaluationCooldown - block.timestamp);
        }

        address wallet = IERC8004Identity(identityRegistry).getAgentWallet(agentId);
        if (wallet == address(0)) revert AgentWalletNotSet(agentId);

        int256 totalScore = 0;
        uint256 totalWeight = 0;
        bytes32[] memory evidenceHashes = new bytes32[](modules.length);
        CorrelationPolicy memory policy = correlationPolicy;
        bool correlationSignalsEnabled = policy.enabled
            && (policy.washSybilEnabled
                || policy.concentrationLowCounterpartiesEnabled
                || policy.youngWalletHighVolumeEnabled);
        CorrelationSignalContext memory correlationSignals;

        for (uint256 i = 0; i < modules.length; i++) {
            if (!modules[i].active) continue;

            (int256 modScore, uint256 confidence, bytes32 evidence) = modules[i].module.evaluate(wallet);
            if (correlationSignalsEnabled && confidence > 0) {
                bytes32 moduleNameHash = keccak256(bytes(modules[i].module.name()));
                if (moduleNameHash == _UNISWAP_MODULE_HASH) {
                    correlationSignals =
                        _loadUniswapCorrelationSignals(correlationSignals, address(modules[i].module), wallet);
                } else if (moduleNameHash == _BASE_ACTIVITY_MODULE_HASH) {
                    correlationSignals =
                        _loadBaseActivityCorrelationSignals(correlationSignals, address(modules[i].module), wallet);
                } else if (moduleNameHash == _AAVE_MODULE_HASH) {
                    correlationSignals =
                        _loadAaveCorrelationSignals(correlationSignals, address(modules[i].module), wallet, evidence);
                }
            }

            uint256 effectiveBaseWeight = _resolveAdaptiveBaseWeight(i, confidence);
            uint256 effectiveWeight = effectiveBaseWeight * confidence / 100;
            if (effectiveWeight > 0) {
                totalScore += modScore * int256(effectiveWeight);
                totalWeight += effectiveWeight;
            }

            moduleScores[agentId][i] = AgentScore({
                score: modScore, timestamp: block.timestamp, evidenceHash: evidence, confidence: confidence
            });
            evidenceHashes[i] = evidence;
        }

        if (totalWeight > 0) {
            totalScore = totalScore / int256(totalWeight);
        }

        CorrelationAssessment memory correlation = _computeCorrelationPenalty(wallet, correlationSignals, policy);
        if (correlation.penalty > 0) {
            totalScore -= correlation.penalty;
            emit CorrelationPenaltyApplied(
                agentId, correlation.penalty, correlation.evidenceHash, correlation.ruleCount
            );
        }

        if (totalScore > ScoreConstants.MAX_SCORE) totalScore = ScoreConstants.MAX_SCORE;
        if (totalScore < ScoreConstants.MIN_SCORE) totalScore = ScoreConstants.MIN_SCORE;

        evidenceHash = keccak256(abi.encode(evidenceHashes, correlation.evidenceHash));
        correlationAssessments[agentId] = correlation;

        agentScores[agentId] = AgentScore({
            score: totalScore,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            confidence: totalWeight > 0 ? 100 : 0
        });
        lastEvaluationTime[agentId] = block.timestamp;

        int128 normalizedScore = int128(totalScore);
        uint8 valueDecimals = 0;
        IERC8004Reputation(reputationRegistry)
            .giveFeedback(agentId, normalizedScore, valueDecimals, "agent-rep-score", "", "", "", evidenceHash);

        emit AgentEvaluated(agentId, totalScore, normalizedScore, valueDecimals, evidenceHash);
        score = totalScore;
    }

    // --- View functions ---

    function getLatestScore(uint256 agentId)
        external
        view
        returns (int256 score, uint256 timestamp, bytes32 evidenceHash)
    {
        AgentScore storage s = agentScores[agentId];
        return (s.score, s.timestamp, s.evidenceHash);
    }

    function getModuleScores(uint256 agentId)
        external
        view
        returns (
            string[] memory names,
            int256[] memory scores,
            uint256[] memory confidences,
            bytes32[] memory evidences
        )
    {
        uint256 len = modules.length;
        names = new string[](len);
        scores = new int256[](len);
        confidences = new uint256[](len);
        evidences = new bytes32[](len);

        for (uint256 i = 0; i < len; i++) {
            AgentScore storage ms = moduleScores[agentId][i];
            names[i] = modules[i].module.name();
            scores[i] = ms.score;
            confidences[i] = ms.confidence;
            evidences[i] = ms.evidenceHash;
        }
    }

    function getModulesWithNames()
        external
        view
        returns (
            address[] memory addresses_,
            string[] memory names,
            string[] memory categories,
            uint256[] memory weights,
            bool[] memory activeStates
        )
    {
        uint256 len = modules.length;
        addresses_ = new address[](len);
        names = new string[](len);
        categories = new string[](len);
        weights = new uint256[](len);
        activeStates = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            addresses_[i] = address(modules[i].module);
            names[i] = modules[i].module.name();
            categories[i] = modules[i].module.category();
            weights[i] = modules[i].weight;
            activeStates[i] = modules[i].active;
        }
    }

    function getModuleHealth()
        external
        view
        returns (string[] memory names, uint256[] memory zeroStreaks, bool[] memory activeStates)
    {
        uint256 len = modules.length;
        names = new string[](len);
        zeroStreaks = new uint256[](len);
        activeStates = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            names[i] = modules[i].module.name();
            zeroStreaks[i] = moduleRuntimeStates[i].zeroConfidenceStreak;
            activeStates[i] = modules[i].active;
        }
    }

    function getModuleRuntimeState(uint256 moduleIndex)
        external
        view
        returns (uint256 zeroConfidenceStreak, uint256 effectiveBaseWeight, uint256 lastUpdatedAt)
    {
        if (moduleIndex >= modules.length) revert ModuleIndexOutOfBounds(moduleIndex);
        ModuleRuntimeState storage runtime = moduleRuntimeStates[moduleIndex];
        return (runtime.zeroConfidenceStreak, _effectiveBaseWeightView(moduleIndex), runtime.lastUpdatedAt);
    }

    function getEffectiveWeights()
        external
        view
        returns (
            string[] memory names,
            uint256[] memory nominalWeights,
            uint256[] memory effectiveBaseWeights,
            bool[] memory activeStates
        )
    {
        uint256 len = modules.length;
        names = new string[](len);
        nominalWeights = new uint256[](len);
        effectiveBaseWeights = new uint256[](len);
        activeStates = new bool[](len);

        for (uint256 i = 0; i < len; i++) {
            names[i] = modules[i].module.name();
            nominalWeights[i] = modules[i].weight;
            effectiveBaseWeights[i] = _effectiveBaseWeightView(i);
            activeStates[i] = modules[i].active;
        }
    }

    function getCorrelationAssessment(uint256 agentId)
        external
        view
        returns (int256 penalty, bytes32 evidenceHash, uint8 ruleCount, uint256 timestamp)
    {
        CorrelationAssessment storage assessment = correlationAssessments[agentId];
        return (assessment.penalty, assessment.evidenceHash, assessment.ruleCount, assessment.timestamp);
    }

    function _loadUniswapCorrelationSignals(CorrelationSignalContext memory signals, address module, address wallet)
        internal
        view
        returns (CorrelationSignalContext memory)
    {
        (
            uint256 swapCount,
            uint256 volumeUSD,,,,
            bool washTradeFlag,
            bool counterpartyConcentrationFlag,
            uint256 timestamp,
            bytes32 evidenceHash,
        ) = IUniswapCorrelationView(module).latestSwapSummary(wallet);

        if (swapCount == 0 || block.timestamp > timestamp + ScoreConstants.DATA_STALE_WINDOW) {
            return signals;
        }

        signals.hasUniswap = true;
        signals.swapCount = swapCount;
        signals.volumeUSD = volumeUSD;
        signals.washTradeFlag = washTradeFlag;
        signals.counterpartyConcentrationFlag = counterpartyConcentrationFlag;
        signals.uniswapEvidenceHash = evidenceHash;
        return signals;
    }

    function _loadBaseActivityCorrelationSignals(
        CorrelationSignalContext memory signals,
        address module,
        address wallet
    ) internal view returns (CorrelationSignalContext memory) {
        (
            uint256 txCount,
            uint256 firstTxTimestamp,,
            uint256 uniqueCounterparties,
            uint256 timestamp,
            bytes32 evidenceHash,
            bool sybilClusterFlag
        ) = IBaseActivityCorrelationView(module).latestActivitySummary(wallet);

        if (txCount == 0 || block.timestamp > timestamp + ScoreConstants.DATA_STALE_WINDOW) {
            return signals;
        }

        signals.hasActivity = true;
        signals.uniqueCounterparties = uniqueCounterparties;
        signals.sybilClusterFlag = sybilClusterFlag;
        signals.activityEvidenceHash = evidenceHash;
        if (firstTxTimestamp <= block.timestamp) {
            signals.walletAgeDays = (block.timestamp - firstTxTimestamp) / 1 days;
        }
        return signals;
    }

    function _loadAaveCorrelationSignals(
        CorrelationSignalContext memory signals,
        address module,
        address wallet,
        bytes32 evidence
    ) internal view returns (CorrelationSignalContext memory) {
        try IAaveCorrelationView(module).walletMeta(wallet) returns (
            uint256 liquidationCount, uint256 suppliedAssetCount, uint256 timestamp
        ) {
            if (timestamp == 0 || block.timestamp > timestamp + ScoreConstants.DATA_STALE_WINDOW) {
                return signals;
            }

            signals.hasAave = true;
            signals.aaveLiquidationCount = liquidationCount;
            signals.aaveSuppliedAssetCount = suppliedAssetCount;
            signals.aaveEvidenceHash = evidence;
            return signals;
        } catch {
            return signals;
        }
    }

    function _computeCorrelationPenalty(
        address wallet,
        CorrelationSignalContext memory signals,
        CorrelationPolicy memory policy
    ) internal view returns (CorrelationAssessment memory) {
        if (!policy.enabled) {
            return CorrelationAssessment({
                penalty: 0, evidenceHash: bytes32(0), ruleCount: 0, timestamp: block.timestamp
            });
        }

        int256 penalty = 0;
        uint8 ruleCount = 0;
        uint8 signalMask = 0;

        if (
            policy.washSybilEnabled && signals.hasUniswap && signals.hasActivity && signals.washTradeFlag
                && signals.sybilClusterFlag
        ) {
            penalty += int256(policy.penaltyWashSybil);
            ruleCount += 1;
            signalMask |= 0x01;
        }

        if (
            policy.concentrationLowCounterpartiesEnabled && signals.hasUniswap && signals.hasActivity
                && signals.counterpartyConcentrationFlag
                && signals.uniqueCounterparties <= policy.lowCounterpartiesThreshold
                && signals.swapCount >= policy.highSwapThreshold
        ) {
            penalty += int256(policy.penaltyConcentrationLowCounterparties);
            ruleCount += 1;
            signalMask |= 0x02;
        }

        if (
            policy.youngWalletHighVolumeEnabled && signals.hasUniswap && signals.hasActivity
                && signals.walletAgeDays <= policy.youngWalletDaysThreshold
                && signals.volumeUSD >= policy.highVolumeThreshold && signals.swapCount >= policy.highSwapThreshold
        ) {
            penalty += int256(policy.penaltyYoungWalletHighVolume);
            ruleCount += 1;
            signalMask |= 0x04;
        }

        int256 maxPenalty = int256(policy.maxPenalty);
        if (maxPenalty >= 0 && penalty > maxPenalty) {
            penalty = maxPenalty;
        }

        bytes32 evidenceHash = bytes32(0);
        if (ruleCount > 0) {
            evidenceHash = keccak256(
                abi.encodePacked(wallet, signalMask, signals.uniswapEvidenceHash, signals.activityEvidenceHash)
            );
        }

        return CorrelationAssessment({
            penalty: penalty, evidenceHash: evidenceHash, ruleCount: ruleCount, timestamp: block.timestamp
        });
    }

    function _resolveAdaptiveBaseWeight(uint256 moduleIndex, uint256 confidence) internal returns (uint256) {
        ModuleRuntimeState storage runtime = moduleRuntimeStates[moduleIndex];
        uint256 nominalWeight = modules[moduleIndex].weight;

        if (!weightPolicy.enabled) {
            runtime.zeroConfidenceStreak = confidence == 0 ? runtime.zeroConfidenceStreak + 1 : 0;
            runtime.effectiveBaseWeight = nominalWeight;
            runtime.lastUpdatedAt = block.timestamp;
            consecutiveZeroConfidence[moduleIndex] = runtime.zeroConfidenceStreak;
            return nominalWeight;
        }

        if (runtime.effectiveBaseWeight == 0 && nominalWeight > 0) {
            runtime.effectiveBaseWeight = nominalWeight;
        }

        uint256 minWeight = _minAdaptiveWeight(nominalWeight);
        if (runtime.effectiveBaseWeight < minWeight) {
            runtime.effectiveBaseWeight = minWeight;
        }

        if (confidence == 0) {
            runtime.zeroConfidenceStreak += 1;
            if (
                weightPolicy.zeroConfidenceThreshold > 0
                    && runtime.zeroConfidenceStreak >= weightPolicy.zeroConfidenceThreshold
                    && weightPolicy.decayStepBps > 0
            ) {
                uint256 decayed = runtime.effectiveBaseWeight > weightPolicy.decayStepBps
                    ? runtime.effectiveBaseWeight - weightPolicy.decayStepBps
                    : 0;
                runtime.effectiveBaseWeight = decayed < minWeight ? minWeight : decayed;
            }
        } else {
            runtime.zeroConfidenceStreak = 0;
            if (runtime.effectiveBaseWeight < nominalWeight && weightPolicy.recoveryStepBps > 0) {
                uint256 recovered = runtime.effectiveBaseWeight + weightPolicy.recoveryStepBps;
                runtime.effectiveBaseWeight = recovered > nominalWeight ? nominalWeight : recovered;
            }
        }

        if (runtime.effectiveBaseWeight > nominalWeight) {
            runtime.effectiveBaseWeight = nominalWeight;
        }

        runtime.lastUpdatedAt = block.timestamp;
        consecutiveZeroConfidence[moduleIndex] = runtime.zeroConfidenceStreak;
        return runtime.effectiveBaseWeight;
    }

    function _effectiveBaseWeightView(uint256 moduleIndex) internal view returns (uint256) {
        uint256 nominalWeight = modules[moduleIndex].weight;
        if (!weightPolicy.enabled) return nominalWeight;
        uint256 effective = moduleRuntimeStates[moduleIndex].effectiveBaseWeight;
        if (effective == 0 && nominalWeight > 0) {
            return nominalWeight;
        }
        if (effective > nominalWeight) {
            return nominalWeight;
        }
        uint256 minWeight = _minAdaptiveWeight(nominalWeight);
        if (effective < minWeight) {
            return minWeight;
        }
        return effective;
    }

    function _minAdaptiveWeight(uint256 nominalWeight) internal view returns (uint256) {
        return nominalWeight * uint256(weightPolicy.minWeightBps) / 10000;
    }

    function _resetModuleRuntimeState(uint256 moduleIndex, uint256 nominalWeight) internal {
        ModuleRuntimeState storage runtime = moduleRuntimeStates[moduleIndex];
        runtime.zeroConfidenceStreak = 0;
        runtime.effectiveBaseWeight = nominalWeight;
        runtime.lastUpdatedAt = block.timestamp;
        consecutiveZeroConfidence[moduleIndex] = 0;
    }
}
