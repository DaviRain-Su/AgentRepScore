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
            AgentRepValidatorV2.initialize,
            (address(identity), address(reputation), address(0), governance)
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
}
