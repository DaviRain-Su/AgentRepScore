// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/AgentRepValidator.sol";
import "../../contracts/mocks/MockIdentityRegistry.sol";
import "../../contracts/mocks/MockReputationRegistry.sol";
import "../../contracts/mocks/MockScoreModule.sol";

contract AgentRepValidatorInvariants is Test {
    AgentRepValidator validator;
    MockIdentityRegistry identityRegistry;
    MockReputationRegistry reputationRegistry;
    MockScoreModule modA;
    MockScoreModule modB;

    address governance = address(this);
    address wallet = address(0x1111);
    uint256 agentId = 1;

    function setUp() public {
        vm.warp(1_700_000_000);
        identityRegistry = new MockIdentityRegistry();
        reputationRegistry = new MockReputationRegistry();
        validator =
            new AgentRepValidator(address(identityRegistry), address(reputationRegistry), address(0), governance);
        modA = new MockScoreModule("ModA", "test", 5000, 100, bytes32(uint256(1)));
        modB = new MockScoreModule("ModB", "test", 6000, 100, bytes32(uint256(2)));

        identityRegistry.setAgentWallet(agentId, wallet);
        validator.setCooldown(0);

        targetContract(address(validator));
    }

    // Invariant 1: total active weight never exceeds 10000
    function invariant_TotalActiveWeightBounded() public view {
        uint256 totalWeight = 0;
        uint256 count = validator.moduleCount();
        for (uint256 i = 0; i < count; i++) {
            (,, bool active) = validator.modules(i);
            if (active) {
                (, uint256 weight,) = validator.modules(i);
                totalWeight += weight;
            }
        }
        assertLe(totalWeight, 10000);
    }

    // Invariant 2: any evaluated agent score must be within [-10000, 10000]
    function invariant_ScoreWithinBounds() public {
        (int256 score,,) = validator.getLatestScore(agentId);
        // If never evaluated, score is 0 (default). Otherwise it must be clamped.
        assertGe(score, ScoreConstants.MIN_SCORE);
        assertLe(score, ScoreConstants.MAX_SCORE);
    }
}
