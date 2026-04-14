// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/AgentRepValidatorV2.sol";
import "../../contracts/mocks/MockIdentityRegistry.sol";
import "../../contracts/mocks/MockReputationRegistry.sol";
import "../../contracts/mocks/MockScoreModule.sol";

contract MockCorrelationUniswapModule is IScoreModule {
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

    int256 private _score = 7000;
    uint256 private _confidence = 100;

    function setSummary(address wallet, SwapSummary calldata summary) external {
        latestSwapSummary[wallet] = summary;
    }

    function setResult(int256 score_, uint256 confidence_) external {
        _score = score_;
        _confidence = confidence_;
    }

    function name() external pure override returns (string memory) {
        return "UniswapScoreModule";
    }

    function category() external pure override returns (string memory) {
        return "dex";
    }

    function metricNames() external pure override returns (string[] memory metrics) {
        metrics = new string[](0);
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        SwapSummary memory summary = latestSwapSummary[wallet];
        return (_score, _confidence, summary.evidenceHash);
    }
}

contract MockCorrelationBaseActivityModule is IScoreModule {
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

    int256 private _score = 7000;
    uint256 private _confidence = 100;

    function setSummary(address wallet, ActivitySummary calldata summary) external {
        latestActivitySummary[wallet] = summary;
    }

    function setResult(int256 score_, uint256 confidence_) external {
        _score = score_;
        _confidence = confidence_;
    }

    function name() external pure override returns (string memory) {
        return "BaseActivityModule";
    }

    function category() external pure override returns (string memory) {
        return "activity";
    }

    function metricNames() external pure override returns (string[] memory metrics) {
        metrics = new string[](0);
    }

    function evaluate(address wallet)
        external
        view
        override
        returns (int256 score, uint256 confidence, bytes32 evidence)
    {
        ActivitySummary memory summary = latestActivitySummary[wallet];
        return (_score, _confidence, summary.evidenceHash);
    }
}

contract MockCorrelationAaveModule is IScoreModule {
    struct WalletMeta {
        uint256 liquidationCount;
        uint256 suppliedAssetCount;
        uint256 timestamp;
    }

    mapping(address => WalletMeta) public walletMeta;

    int256 private _score = 7000;
    uint256 private _confidence = 100;
    bytes32 private _evidence = bytes32(uint256(0xa11ce));

    function setWalletMeta(address wallet, WalletMeta calldata meta) external {
        walletMeta[wallet] = meta;
    }

    function setResult(int256 score_, uint256 confidence_, bytes32 evidence_) external {
        _score = score_;
        _confidence = confidence_;
        _evidence = evidence_;
    }

    function name() external pure override returns (string memory) {
        return "AaveScoreModule";
    }

    function category() external pure override returns (string memory) {
        return "lending";
    }

    function metricNames() external pure override returns (string[] memory metrics) {
        metrics = new string[](0);
    }

    function evaluate(address) external view override returns (int256 score, uint256 confidence, bytes32 evidence) {
        return (_score, _confidence, _evidence);
    }
}

contract AgentRepValidatorV2Test is Test {
    AgentRepValidatorV2 public implementation;
    AgentRepValidatorV2 public validator;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    address public governance;
    address public user;

    function setUp() public {
        vm.warp(1_700_000_000);
        governance = address(this);
        user = address(0xBEEF);

        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();

        implementation = new AgentRepValidatorV2();

        bytes memory initData = abi.encodeCall(
            AgentRepValidatorV2.initialize, (address(identity), address(reputation), address(0), governance)
        );

        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        validator = AgentRepValidatorV2(address(proxy));
    }

    function test_InitializesSetsState() public view {
        assertEq(validator.identityRegistry(), address(identity));
        assertEq(validator.reputationRegistry(), address(reputation));
        assertEq(validator.governance(), governance);
        assertTrue(validator.evaluators(governance));
        assertEq(validator.evaluationCooldown(), 1 days);
        (
            bool enabled,
            uint16 minWeightBps,
            uint16 decayStepBps,
            uint16 recoveryStepBps,
            uint8 zeroConfidenceThreshold
        ) = validator.getWeightPolicy();
        assertTrue(enabled);
        assertEq(minWeightBps, 2000);
        assertEq(decayStepBps, 500);
        assertEq(recoveryStepBps, 250);
        assertEq(zeroConfidenceThreshold, 3);
        assertEq(validator.autoDeactivateThreshold(), 3);
        (
            bool correlationEnabled,
            bool washSybilEnabled,
            bool concentrationEnabled,
            bool youngVolumeEnabled,
            uint256 highSwapThreshold,
            uint256 lowCounterpartiesThreshold,
            uint256 highVolumeThreshold,
            uint256 youngWalletDaysThreshold,
            uint256 penaltyWashSybil,
            uint256 penaltyConcentration,
            uint256 penaltyYoungVolume,
            uint256 maxPenalty
        ) = validator.getCorrelationPolicy();
        assertTrue(correlationEnabled);
        assertTrue(washSybilEnabled);
        assertTrue(concentrationEnabled);
        assertTrue(youngVolumeEnabled);
        assertEq(highSwapThreshold, 50);
        assertEq(lowCounterpartiesThreshold, 2);
        assertEq(highVolumeThreshold, 100_000e6);
        assertEq(youngWalletDaysThreshold, 14);
        assertEq(penaltyWashSybil, 2500);
        assertEq(penaltyConcentration, 1200);
        assertEq(penaltyYoungVolume, 1000);
        assertEq(maxPenalty, 5000);
    }

    function test_Version() public view {
        assertEq(validator.version(), "2.0.0");
    }

    function test_CannotInitializeTwice() public {
        vm.expectRevert();
        validator.initialize(address(0), address(0), address(0), address(0));
    }

    function test_CannotInitializeImplementation() public {
        vm.expectRevert();
        implementation.initialize(address(0), address(0), address(0), address(0));
    }

    function test_BootstrapModules() public {
        MockScoreModule mod1 = new MockScoreModule("Mod1", "test", 5000, 100, bytes32(0));
        MockScoreModule mod2 = new MockScoreModule("Mod2", "test", 5000, 100, bytes32(0));

        IScoreModule[] memory mods = new IScoreModule[](2);
        mods[0] = mod1;
        mods[1] = mod2;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 6000;
        weights[1] = 4000;

        validator.bootstrapModules(mods, weights);
        assertEq(validator.moduleCount(), 2);
    }

    function test_EvaluateAgentThroughProxy() public {
        MockScoreModule mod = new MockScoreModule("TestMod", "test", 7000, 100, bytes32(uint256(0xdead)));

        IScoreModule[] memory mods = new IScoreModule[](1);
        mods[0] = mod;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;

        validator.bootstrapModules(mods, weights);

        identity.register("https://example.com");
        identity.setAgentWallet(0, user);

        vm.warp(block.timestamp + 1 days + 1);
        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 7000);
    }

    function test_OnlyGovernanceCanUpgrade() public {
        AgentRepValidatorV2 newImpl = new AgentRepValidatorV2();

        vm.prank(user);
        vm.expectRevert();
        validator.upgradeToAndCall(address(newImpl), "");

        // Governance can upgrade
        validator.upgradeToAndCall(address(newImpl), "");
        assertEq(validator.version(), "2.0.0");
    }

    function test_StatePreservedAfterUpgrade() public {
        MockScoreModule mod = new MockScoreModule("Preserved", "test", 5000, 80, bytes32(uint256(0xface)));

        IScoreModule[] memory mods = new IScoreModule[](1);
        mods[0] = mod;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;

        validator.bootstrapModules(mods, weights);

        identity.register("https://example.com");
        identity.setAgentWallet(0, user);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);

        (int256 scoreBefore,,) = validator.getLatestScore(0);

        AgentRepValidatorV2 newImpl = new AgentRepValidatorV2();
        validator.upgradeToAndCall(address(newImpl), "");

        (int256 scoreAfter,,) = validator.getLatestScore(0);
        assertEq(scoreBefore, scoreAfter);
        assertEq(validator.moduleCount(), 1);
        assertEq(validator.governance(), governance);
    }

    function test_PauseUnpauseThroughProxy() public {
        assertFalse(validator.paused());
        validator.pause();
        assertTrue(validator.paused());
        validator.unpause();
        assertFalse(validator.paused());
    }

    // --- Adaptive weight tests ---

    function _setupModuleAndAgent(MockScoreModule mod) internal {
        IScoreModule[] memory mods = new IScoreModule[](1);
        mods[0] = mod;
        uint256[] memory weights = new uint256[](1);
        weights[0] = 10000;
        validator.bootstrapModules(mods, weights);

        identity.register("https://example.com");
        identity.setAgentWallet(0, user);
        validator.setCooldown(0);
        vm.warp(block.timestamp + 1 days + 1);
    }

    function _setupCorrelationModules()
        internal
        returns (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule)
    {
        uniswapModule = new MockCorrelationUniswapModule();
        activityModule = new MockCorrelationBaseActivityModule();

        IScoreModule[] memory mods = new IScoreModule[](2);
        mods[0] = uniswapModule;
        mods[1] = activityModule;
        uint256[] memory weights = new uint256[](2);
        weights[0] = 5000;
        weights[1] = 5000;

        validator.bootstrapModules(mods, weights);
        identity.register("https://example.com");
        identity.setAgentWallet(0, user);
        validator.setCooldown(0);
        vm.warp(block.timestamp + 1 days + 1);
    }

    function _setupCorrelationModulesWithAave()
        internal
        returns (
            MockCorrelationUniswapModule uniswapModule,
            MockCorrelationBaseActivityModule activityModule,
            MockCorrelationAaveModule aaveModule
        )
    {
        uniswapModule = new MockCorrelationUniswapModule();
        activityModule = new MockCorrelationBaseActivityModule();
        aaveModule = new MockCorrelationAaveModule();

        IScoreModule[] memory mods = new IScoreModule[](3);
        mods[0] = uniswapModule;
        mods[1] = activityModule;
        mods[2] = aaveModule;
        uint256[] memory weights = new uint256[](3);
        weights[0] = 4000;
        weights[1] = 4000;
        weights[2] = 2000;

        validator.bootstrapModules(mods, weights);
        identity.register("https://example.com");
        identity.setAgentWallet(0, user);
        validator.setCooldown(0);
        vm.warp(block.timestamp + 1 days + 1);
    }

    function test_AdaptiveWeightDecaysAfterThreshold() public {
        MockScoreModule mod = new MockScoreModule("Stale", "test", 0, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        validator.setWeightPolicy(true, 2000, 1000, 500, 2);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (uint256 streak1, uint256 effective1,) = validator.getModuleRuntimeState(0);
        assertEq(streak1, 1);
        assertEq(effective1, 10000);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (uint256 streak2, uint256 effective2,) = validator.getModuleRuntimeState(0);
        assertEq(streak2, 2);
        assertEq(effective2, 9000);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (uint256 streak3, uint256 effective3,) = validator.getModuleRuntimeState(0);
        assertEq(streak3, 3);
        assertEq(effective3, 8000);

        (,, bool active) = validator.modules(0);
        assertTrue(active);
    }

    function test_AdaptiveWeightRecoveryCappedByNominalWeight() public {
        MockScoreModule mod = new MockScoreModule("Flaky", "test", 5000, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        validator.setWeightPolicy(true, 2000, 2000, 500, 1);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (, uint256 decayedWeight,) = validator.getModuleRuntimeState(0);
        assertEq(decayedWeight, 8000);

        mod.setResult(5000, 100, bytes32(uint256(0xaa)));
        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (uint256 streakAfterRecovery, uint256 recoveredWeight,) = validator.getModuleRuntimeState(0);
        assertEq(streakAfterRecovery, 0);
        assertEq(recoveredWeight, 8500);

        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1 days + 1);
            validator.evaluateAgent(0);
        }

        (, uint256 finalWeight,) = validator.getModuleRuntimeState(0);
        assertEq(finalWeight, 10000);
    }

    function test_AdaptiveWeightRespectsMinimumFloor() public {
        MockScoreModule mod = new MockScoreModule("Floor", "test", 0, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        validator.setWeightPolicy(true, 8000, 2000, 500, 1);

        for (uint256 i = 0; i < 5; i++) {
            vm.warp(block.timestamp + 1 days + 1);
            validator.evaluateAgent(0);
        }

        (uint256 streak, uint256 effectiveWeight,) = validator.getModuleRuntimeState(0);
        assertEq(streak, 5);
        assertEq(effectiveWeight, 8000);
    }

    function test_DisablingPolicyResetsEffectiveWeight() public {
        MockScoreModule mod = new MockScoreModule("Toggle", "test", 0, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        validator.setWeightPolicy(true, 2000, 2000, 500, 1);
        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        (, uint256 effectiveWhenEnabled,) = validator.getModuleRuntimeState(0);
        assertEq(effectiveWhenEnabled, 8000);

        validator.setWeightPolicy(false, 0, 0, 0, 0);
        (uint256 streakAfterDisable, uint256 effectiveWhenDisabled,) = validator.getModuleRuntimeState(0);
        assertEq(streakAfterDisable, 0);
        assertEq(effectiveWhenDisabled, 10000);
    }

    function test_GetEffectiveWeights() public {
        MockScoreModule mod = new MockScoreModule("Weights", "test", 0, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        validator.setWeightPolicy(true, 2000, 1000, 500, 2);
        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);

        (
            string[] memory names,
            uint256[] memory nominalWeights,
            uint256[] memory effectiveBaseWeights,
            bool[] memory activeStates
        ) = validator.getEffectiveWeights();
        assertEq(names.length, 1);
        assertEq(names[0], "Weights");
        assertEq(nominalWeights[0], 10000);
        assertEq(effectiveBaseWeights[0], 9000);
        assertTrue(activeStates[0]);
    }

    function test_SetAutoDeactivateThresholdUpdatesPolicyThreshold() public {
        validator.setAutoDeactivateThreshold(9);
        (,,,, uint8 threshold) = validator.getWeightPolicy();
        assertEq(threshold, 9);
        assertEq(validator.autoDeactivateThreshold(), 9);
    }

    function test_SetCorrelationPolicy_OnlyGovernance() public {
        vm.prank(user);
        vm.expectRevert();
        validator.setCorrelationPolicy(true, true, true, true, 50, 2, 100_000e6, 14, 2500, 1200, 1000, 5000);
    }

    function test_SetCorrelationPolicy_InvalidPenaltyConfigReverts() public {
        vm.expectRevert(AgentRepValidatorV2.InvalidCorrelationPolicy.selector);
        validator.setCorrelationPolicy(true, true, true, true, 50, 2, 100_000e6, 14, 2500, 1200, 1000, 900);
    }

    function test_CorrelationPolicy_DisabledSkipsPenalty() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        validator.setCorrelationPolicy(false, true, true, true, 50, 2, 100_000e6, 14, 2500, 1200, 1000, 5000);

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 100,
                volumeUSD: 20_000e6,
                netPnL: 0,
                avgSlippageBps: 20,
                feeToPnlRatioBps: 300,
                washTradeFlag: true,
                counterpartyConcentrationFlag: true,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x1212)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 500,
                firstTxTimestamp: block.timestamp - 180 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 1,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x3434)),
                sybilClusterFlag: true
            })
        );

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 7000);

        (int256 penalty, bytes32 evidenceHash, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 0);
        assertEq(ruleCount, 0);
        assertEq(evidenceHash, bytes32(0));
    }

    function test_CorrelationPolicy_ThresholdAndPenaltyOverride() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        validator.setCorrelationPolicy(true, false, true, false, 80, 2, 100_000e6, 14, 2500, 1600, 1000, 5000);

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 70,
                volumeUSD: 5_000e6,
                netPnL: 0,
                avgSlippageBps: 20,
                feeToPnlRatioBps: 200,
                washTradeFlag: false,
                counterpartyConcentrationFlag: true,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x5656)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 300,
                firstTxTimestamp: block.timestamp - 120 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 2,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x7878)),
                sybilClusterFlag: false
            })
        );

        (int256 scoreWithoutPenalty,) = validator.evaluateAgent(0);
        assertEq(scoreWithoutPenalty, 7000);

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 90,
                volumeUSD: 5_000e6,
                netPnL: 0,
                avgSlippageBps: 20,
                feeToPnlRatioBps: 200,
                washTradeFlag: false,
                counterpartyConcentrationFlag: true,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x9999)),
                pool: address(0)
            })
        );

        (int256 scoreWithPenalty,) = validator.evaluateAgent(0);
        assertEq(scoreWithPenalty, 5400);

        (int256 penalty,, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 1600);
        assertEq(ruleCount, 1);
    }

    function test_CorrelationPenalty_AaveHookWithMeta_DoesNotChangeCurrentRules() public {
        (
            MockCorrelationUniswapModule uniswapModule,
            MockCorrelationBaseActivityModule activityModule,
            MockCorrelationAaveModule aaveModule
        ) = _setupCorrelationModulesWithAave();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 80,
                volumeUSD: 10_000e6,
                netPnL: 0,
                avgSlippageBps: 25,
                feeToPnlRatioBps: 300,
                washTradeFlag: true,
                counterpartyConcentrationFlag: false,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x111100)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 400,
                firstTxTimestamp: block.timestamp - 180 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 20,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x222200)),
                sybilClusterFlag: true
            })
        );

        aaveModule.setWalletMeta(
            user,
            MockCorrelationAaveModule.WalletMeta({
                liquidationCount: 2, suppliedAssetCount: 3, timestamp: block.timestamp
            })
        );
        aaveModule.setResult(7000, 100, bytes32(uint256(0x333300)));

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 4500);

        (int256 penalty,, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 2500);
        assertEq(ruleCount, 1);
    }

    function test_CorrelationPenalty_AaveHookWithEmptyMeta_DoesNotChangeCurrentRules() public {
        (
            MockCorrelationUniswapModule uniswapModule,
            MockCorrelationBaseActivityModule activityModule,
            MockCorrelationAaveModule aaveModule
        ) = _setupCorrelationModulesWithAave();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 80,
                volumeUSD: 10_000e6,
                netPnL: 0,
                avgSlippageBps: 25,
                feeToPnlRatioBps: 300,
                washTradeFlag: true,
                counterpartyConcentrationFlag: false,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x111101)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 400,
                firstTxTimestamp: block.timestamp - 180 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 20,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x222201)),
                sybilClusterFlag: true
            })
        );

        aaveModule.setResult(7000, 100, bytes32(uint256(0x333301)));

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 4500);

        (int256 penalty,, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 2500);
        assertEq(ruleCount, 1);
    }

    function test_CorrelationPenalty_WashTradeAndSybilResonance() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 80,
                volumeUSD: 10_000e6,
                netPnL: 0,
                avgSlippageBps: 25,
                feeToPnlRatioBps: 300,
                washTradeFlag: true,
                counterpartyConcentrationFlag: false,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x1111)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 400,
                firstTxTimestamp: block.timestamp - 180 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 20,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x2222)),
                sybilClusterFlag: true
            })
        );

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 4500);

        (int256 penalty, bytes32 evidenceHash, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 2500);
        assertEq(ruleCount, 1);
        assertTrue(evidenceHash != bytes32(0));
    }

    function test_CorrelationPenalty_ConcentrationAndLowCounterparties() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 90,
                volumeUSD: 5_000e6,
                netPnL: 0,
                avgSlippageBps: 15,
                feeToPnlRatioBps: 250,
                washTradeFlag: false,
                counterpartyConcentrationFlag: true,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x3333)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 300,
                firstTxTimestamp: block.timestamp - 120 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 2,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x4444)),
                sybilClusterFlag: false
            })
        );

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 5800);

        (int256 penalty,, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 1200);
        assertEq(ruleCount, 1);
    }

    function test_CorrelationPenalty_YoungWalletAndHighVolume() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 75,
                volumeUSD: 120_000e6,
                netPnL: 0,
                avgSlippageBps: 20,
                feeToPnlRatioBps: 200,
                washTradeFlag: false,
                counterpartyConcentrationFlag: false,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x5555)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 250,
                firstTxTimestamp: block.timestamp - 5 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 14,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x6666)),
                sybilClusterFlag: false
            })
        );

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 6000);

        (int256 penalty,, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 1000);
        assertEq(ruleCount, 1);
    }

    function test_CorrelationPenalty_NoSignal() public {
        (MockCorrelationUniswapModule uniswapModule, MockCorrelationBaseActivityModule activityModule) =
            _setupCorrelationModules();

        uniswapModule.setSummary(
            user,
            MockCorrelationUniswapModule.SwapSummary({
                swapCount: 10,
                volumeUSD: 1_000e6,
                netPnL: 0,
                avgSlippageBps: 10,
                feeToPnlRatioBps: 100,
                washTradeFlag: false,
                counterpartyConcentrationFlag: false,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x7777)),
                pool: address(0)
            })
        );

        activityModule.setSummary(
            user,
            MockCorrelationBaseActivityModule.ActivitySummary({
                txCount: 200,
                firstTxTimestamp: block.timestamp - 90 days,
                lastTxTimestamp: block.timestamp,
                uniqueCounterparties: 12,
                timestamp: block.timestamp,
                evidenceHash: bytes32(uint256(0x8888)),
                sybilClusterFlag: false
            })
        );

        (int256 score,) = validator.evaluateAgent(0);
        assertEq(score, 7000);

        (int256 penalty, bytes32 evidenceHash, uint8 ruleCount,) = validator.getCorrelationAssessment(0);
        assertEq(penalty, 0);
        assertEq(ruleCount, 0);
        assertEq(evidenceHash, bytes32(0));
    }

    function test_GetModuleHealth() public {
        MockScoreModule mod = new MockScoreModule("Health", "test", 0, 0, bytes32(0));
        _setupModuleAndAgent(mod);

        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);
        vm.warp(block.timestamp + 1 days + 1);
        validator.evaluateAgent(0);

        (string[] memory names, uint256[] memory zeroStreaks, bool[] memory activeStates) = validator.getModuleHealth();
        assertEq(names.length, 1);
        assertEq(names[0], "Health");
        assertEq(zeroStreaks[0], 2);
        assertTrue(activeStates[0]);
    }
}
