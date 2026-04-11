// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/AgentRepValidator.sol";
import "../../contracts/mocks/MockIdentityRegistry.sol";
import "../../contracts/mocks/MockReputationRegistry.sol";
import "../../contracts/mocks/MockScoreModule.sol";

contract AgentRepValidatorTest is Test {
    AgentRepValidator validator;
    MockIdentityRegistry identityRegistry;
    MockReputationRegistry reputationRegistry;
    MockScoreModule modA;
    MockScoreModule modB;
    MockScoreModule modC;

    address governance = address(this);
    address wallet = address(0x1111);
    uint256 agentId = 1;

    function setUp() public {
        vm.warp(1_700_000_000);
        identityRegistry = new MockIdentityRegistry();
        reputationRegistry = new MockReputationRegistry();
        validator = new AgentRepValidator(
            address(identityRegistry),
            address(reputationRegistry),
            address(0), // validationRegistry not used in these tests
            governance
        );
        modA = new MockScoreModule("ModA", "test", 8000, 100, bytes32(uint256(1)));
        modB = new MockScoreModule("ModB", "test", 6000, 100, bytes32(uint256(2)));
        modC = new MockScoreModule("ModC", "test", 4000, 100, bytes32(uint256(3)));

        identityRegistry.setAgentWallet(agentId, wallet);
        validator.setCooldown(0);
    }

    function test_RegisterModule() public {
        validator.registerModule(modA, 4000);
        (IScoreModule m, uint256 w, bool a) = validator.modules(0);
        assertEq(address(m), address(modA));
        assertEq(w, 4000);
        assertTrue(a);
    }

    function test_RegisterModule_NotGovernance() public {
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.UnauthorizedGovernance.selector, address(0xdead)));
        validator.registerModule(modA, 1000);
    }

    function test_RegisterModule_WeightOverflow() public {
        validator.registerModule(modA, 6000);
        validator.registerModule(modB, 3500);
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.TotalWeightExceeded.selector, 10500));
        validator.registerModule(modC, 1000);
    }

    function test_UpdateWeight() public {
        validator.registerModule(modA, 4000);
        validator.updateWeight(0, 5000);
        (, uint256 w, ) = validator.modules(0);
        assertEq(w, 5000);
    }

    function test_SetModuleActive() public {
        validator.registerModule(modA, 4000);
        validator.setModuleActive(0, false);
        (, , bool a) = validator.modules(0);
        assertFalse(a);
    }

    function test_EvaluateAgent_Normal() public {
        validator.registerModule(modA, 4000);
        validator.registerModule(modB, 3500);
        validator.registerModule(modC, 2500);

        (int256 score, bytes32 evidenceHash) = validator.evaluateAgent(agentId);
        // weighted avg: (8000*4000 + 6000*3500 + 4000*2500) / 10000 = 6300
        assertEq(score, 6300);

        MockReputationRegistry.FeedbackCall memory call = reputationRegistry.lastCall();
        assertEq(call.agentId, agentId);
        assertEq(call.value, 6300);
        assertEq(call.valueDecimals, 0);
        assertEq(call.tag1, "agent-rep-score");
        assertEq(call.feedbackHash, evidenceHash);
    }

    function test_EvaluateAgent_Cooldown() public {
        validator.setCooldown(1 hours);
        validator.registerModule(modA, 10000);
        validator.evaluateAgent(agentId);
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.CooldownNotElapsed.selector, 1 hours));
        validator.evaluateAgent(agentId);
    }

    function test_EvaluateAgent_AgentWalletNotSet() public {
        validator.registerModule(modA, 10000);
        uint256 badAgent = 999;
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.AgentWalletNotSet.selector, badAgent));
        validator.evaluateAgent(badAgent);
    }

    function test_EvaluateAgent_ZeroConfidenceModuleIgnored() public {
        modB.setResult(6000, 0, bytes32(uint256(2)));
        validator.registerModule(modA, 4000);
        validator.registerModule(modB, 3500);
        validator.registerModule(modC, 2500);

        (int256 score,) = validator.evaluateAgent(agentId);
        // (8000*4000 + 4000*2500) / 6500 = 6461 (int division truncates)
        assertEq(score, 6461);
    }

    function test_EvaluateAgent_NegativeTotalScore() public {
        modA.setResult(-5000, 100, bytes32(uint256(1)));
        modB.setResult(-3000, 100, bytes32(uint256(2)));
        modC.setResult(-1000, 100, bytes32(uint256(3)));
        validator.registerModule(modA, 4000);
        validator.registerModule(modB, 3500);
        validator.registerModule(modC, 2500);

        (int256 score,) = validator.evaluateAgent(agentId);
        // (-5000*4000 + -3000*3500 + -1000*2500) / 10000 = -3300
        assertEq(score, -3300);

        MockReputationRegistry.FeedbackCall memory call = reputationRegistry.lastCall();
        assertEq(call.value, -3300);
    }

    function test_SetCooldown() public {
        validator.setCooldown(12 hours);
        assertEq(validator.evaluationCooldown(), 12 hours);
    }

    function test_SetCooldown_NotGovernance() public {
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.UnauthorizedGovernance.selector, address(0xdead)));
        validator.setCooldown(1 hours);
    }

    function test_GetLatestScore() public {
        validator.registerModule(modA, 10000);
        (int256 score, ) = validator.evaluateAgent(agentId);
        (int256 s, uint256 ts, bytes32 ev) = validator.getLatestScore(agentId);
        assertEq(s, score);
        assertEq(ts, block.timestamp);
        assertEq(ev, ev); // non-zero
    }

    function test_HandleValidationRequest() public {
        validator.registerModule(modA, 10000);
        bytes32 req = keccak256("test");
        validator.handleValidationRequest(req, agentId);
        assertTrue(validator.validationHandled(req));
    }

    function test_HandleValidationRequest_Duplicate() public {
        validator.registerModule(modA, 10000);
        bytes32 req = keccak256("test");
        validator.handleValidationRequest(req, agentId);
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.ValidationAlreadyHandled.selector, req));
        validator.handleValidationRequest(req, agentId);
    }
}
