// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/AgentRepValidatorV2.sol";
import "../../contracts/mocks/MockIdentityRegistry.sol";
import "../../contracts/mocks/MockReputationRegistry.sol";
import "../../contracts/mocks/MockScoreModule.sol";

contract AgentRepValidatorV2Test is Test {
    AgentRepValidatorV2 public implementation;
    AgentRepValidatorV2 public validator;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;
    address public governance;
    address public user;

    function setUp() public {
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
