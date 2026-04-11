// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IScoreModule.sol";
import "./interfaces/IERC8004.sol";
import "./ScoreConstants.sol";

contract AgentRepValidator {
    // ERC-8004 registries (immutable)
    address public immutable identityRegistry;
    address public immutable reputationRegistry;
    address public immutable validationRegistry;

    // Validation Registry stub
    mapping(bytes32 => bool) public validationHandled;

    // Governance
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

    uint256 public evaluationCooldown = ScoreConstants.COOLDOWN_DEFAULT;
    mapping(uint256 => uint256) public lastEvaluationTime;

    // Reentrancy guard (simplified, no OZ dependency)
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // Evaluator role (governance or keeper)
    mapping(address => bool) public evaluators;

    modifier onlyEvaluator() {
        if (msg.sender != governance && !evaluators[msg.sender]) revert UnauthorizedEvaluator(msg.sender);
        _;
    }

    // Governance transfer (two-step)
    address public pendingGovernance;

    // Custom errors
    error CooldownNotElapsed(uint256 remaining);
    error AgentWalletNotSet(uint256 agentId);
    error ModuleIndexOutOfBounds(uint256 index);
    error UnauthorizedGovernance(address caller);
    error UnauthorizedEvaluator(address caller);
    error TotalWeightExceeded(uint256 totalWeight);
    error ValidationAlreadyHandled(bytes32 requestHash);
    error InvalidValidationRegistry(address registry);
    error ValidationRequestNotFound(bytes32 requestHash);

    // Events
    event ModuleRegistered(address indexed module, uint256 weight);
    event ModuleUpdated(uint256 indexed index, uint256 newWeight, bool active);
    event AgentEvaluated(
        uint256 indexed agentId, int256 score, int128 normalizedScore, uint8 valueDecimals, bytes32 evidenceHash
    );
    event ValidationResponded(bytes32 indexed requestHash, uint256 indexed agentId, int256 score, bytes32 evidenceHash);
    event EvaluatorSet(address indexed evaluator, bool allowed);
    event GovernanceTransferInitiated(address indexed previousGovernance, address indexed pendingGovernance);
    event GovernanceTransferAccepted(address indexed newGovernance);

    modifier onlyGovernance() {
        if (msg.sender != governance) revert UnauthorizedGovernance(msg.sender);
        _;
    }

    constructor(
        address identityRegistry_,
        address reputationRegistry_,
        address validationRegistry_,
        address governance_
    ) {
        identityRegistry = identityRegistry_;
        reputationRegistry = reputationRegistry_;
        validationRegistry = validationRegistry_;
        governance = governance_;
        evaluators[governance_] = true;
    }

    function setEvaluator(address evaluator, bool allowed) external onlyGovernance {
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

    function _totalActiveWeight() internal view returns (uint256 totalWeight) {
        for (uint256 i = 0; i < modules.length; i++) {
            if (modules[i].active) {
                totalWeight += modules[i].weight;
            }
        }
    }

    function registerModule(IScoreModule module, uint256 weight) external onlyGovernance {
        uint256 totalWeight = _totalActiveWeight();
        if (totalWeight + weight > 10000) revert TotalWeightExceeded(totalWeight + weight);
        modules.push(ModuleConfig({module: module, weight: weight, active: true}));
        emit ModuleRegistered(address(module), weight);
    }

    function updateWeight(uint256 moduleIndex, uint256 newWeight) external onlyGovernance {
        if (moduleIndex >= modules.length) revert ModuleIndexOutOfBounds(moduleIndex);
        modules[moduleIndex].weight = newWeight;
        uint256 totalWeight = _totalActiveWeight();
        if (totalWeight > 10000) revert TotalWeightExceeded(totalWeight);
        emit ModuleUpdated(moduleIndex, newWeight, modules[moduleIndex].active);
    }

    function setModuleActive(uint256 moduleIndex, bool active) external onlyGovernance {
        if (moduleIndex >= modules.length) revert ModuleIndexOutOfBounds(moduleIndex);
        modules[moduleIndex].active = active;
        if (active) {
            uint256 totalWeight = _totalActiveWeight();
            if (totalWeight > 10000) revert TotalWeightExceeded(totalWeight);
        }
        emit ModuleUpdated(moduleIndex, modules[moduleIndex].weight, active);
    }

    function setCooldown(uint256 cooldown) external onlyGovernance {
        evaluationCooldown = cooldown;
    }

    function moduleCount() external view returns (uint256) {
        return modules.length;
    }

    function handleValidationRequest(bytes32 requestHash, uint256 agentId) external onlyEvaluator nonReentrant {
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

        for (uint256 i = 0; i < modules.length; i++) {
            if (!modules[i].active) continue;

            (int256 modScore, uint256 confidence, bytes32 evidence) = modules[i].module.evaluate(wallet);

            uint256 effectiveWeight = modules[i].weight * confidence / 100;
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

        // Clamp
        if (totalScore > ScoreConstants.MAX_SCORE) totalScore = ScoreConstants.MAX_SCORE;
        if (totalScore < ScoreConstants.MIN_SCORE) totalScore = ScoreConstants.MIN_SCORE;

        evidenceHash = keccak256(abi.encodePacked(evidenceHashes));

        agentScores[agentId] = AgentScore({
            score: totalScore,
            timestamp: block.timestamp,
            evidenceHash: evidenceHash,
            confidence: totalWeight > 0 ? 100 : 0
        });
        lastEvaluationTime[agentId] = block.timestamp;

        // Safe cast: totalScore is clamped to [-10000, 10000], well within int128 range
        int128 normalizedScore = int128(totalScore);
        uint8 valueDecimals = 0;
        IERC8004Reputation(reputationRegistry)
            .giveFeedback(agentId, normalizedScore, valueDecimals, "agent-rep-score", "", "", "", evidenceHash);

        emit AgentEvaluated(agentId, totalScore, normalizedScore, valueDecimals, evidenceHash);
        score = totalScore;
    }

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

        return (names, scores, confidences, evidences);
    }
}
