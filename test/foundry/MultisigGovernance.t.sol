// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/AgentRepValidator.sol";
import "../../contracts/mocks/MockIdentityRegistry.sol";
import "../../contracts/mocks/MockReputationRegistry.sol";
import "../../contracts/mocks/MockScoreModule.sol";
import "../../contracts/mocks/MockMultisig.sol";

contract MultisigGovernanceTest is Test {
    AgentRepValidator validator;
    MockIdentityRegistry identityRegistry;
    MockReputationRegistry reputationRegistry;
    MockScoreModule modA;
    MockMultisig multisig;

    address owner1 = address(0xA1);
    address owner2 = address(0xA2);
    address owner3 = address(0xA3);
    address wallet = address(0x1111);
    uint256 agentId = 1;

    function setUp() public {
        vm.warp(1_700_000_000);
        identityRegistry = new MockIdentityRegistry();
        reputationRegistry = new MockReputationRegistry();

        address[] memory owners = new address[](3);
        owners[0] = owner1;
        owners[1] = owner2;
        owners[2] = owner3;
        multisig = new MockMultisig(owners);

        validator = new AgentRepValidator(
            address(identityRegistry),
            address(reputationRegistry),
            address(0),
            address(multisig)
        );

        modA = new MockScoreModule("ModA", "test", 8000, 100, bytes32(uint256(1)));
        identityRegistry.setAgentWallet(agentId, wallet);
    }

    // Helper: build and execute a governance call through the mock multisig
    function _multisigExecute(address target, bytes memory data) internal {
        vm.prank(owner1);
        multisig.approve(target, data);
        vm.prank(owner2);
        multisig.approve(target, data);
        vm.prank(owner1);
        multisig.execute(target, data);
    }

    function test_Multisig_RegisterModule() public {
        bytes memory data = abi.encodeWithSelector(AgentRepValidator.scheduleRegisterModule.selector, modA, 4000);
        _multisigExecute(address(validator), data);

        vm.warp(block.timestamp + validator.TIMELOCK_DELAY() + 1);

        data = abi.encodeWithSelector(AgentRepValidator.executeRegisterModule.selector, modA, 4000);
        _multisigExecute(address(validator), data);

        (IScoreModule m, uint256 w, bool a) = validator.modules(0);
        assertEq(address(m), address(modA));
        assertEq(w, 4000);
        assertTrue(a);
    }

    function test_Multisig_UpdateWeight() public {
        // bootstrap a module first
        bytes memory data = abi.encodeWithSelector(AgentRepValidator.scheduleRegisterModule.selector, modA, 4000);
        _multisigExecute(address(validator), data);
        vm.warp(block.timestamp + validator.TIMELOCK_DELAY() + 1);
        data = abi.encodeWithSelector(AgentRepValidator.executeRegisterModule.selector, modA, 4000);
        _multisigExecute(address(validator), data);

        // update weight
        data = abi.encodeWithSelector(AgentRepValidator.scheduleUpdateWeight.selector, 0, 5000);
        _multisigExecute(address(validator), data);
        vm.warp(block.timestamp + validator.TIMELOCK_DELAY() + 1);
        data = abi.encodeWithSelector(AgentRepValidator.executeUpdateWeight.selector, 0, 5000);
        _multisigExecute(address(validator), data);

        (, uint256 w,) = validator.modules(0);
        assertEq(w, 5000);
    }

    function test_Multisig_GovernanceTransfer() public {
        address newMultisig = address(0xBEEF);

        bytes memory data = abi.encodeWithSelector(AgentRepValidator.initiateGovernanceTransfer.selector, newMultisig);
        _multisigExecute(address(validator), data);

        assertEq(validator.pendingGovernance(), newMultisig);

        vm.prank(newMultisig);
        validator.acceptGovernanceTransfer();

        assertEq(validator.governance(), newMultisig);
        assertEq(validator.pendingGovernance(), address(0));
    }

    function test_Multisig_Pause() public {
        bytes memory data = abi.encodeWithSelector(AgentRepValidator.pause.selector);
        _multisigExecute(address(validator), data);
        assertTrue(validator.paused());
    }

    function test_Multisig_SetEvaluator() public {
        address keeper = address(0xbeef);
        bytes memory data = abi.encodeWithSelector(AgentRepValidator.setEvaluator.selector, keeper, true);
        _multisigExecute(address(validator), data);
        assertTrue(validator.evaluators(keeper));
    }

    function test_NonMultisig_CannotGovern() public {
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(AgentRepValidator.UnauthorizedGovernance.selector, address(0xdead)));
        validator.scheduleRegisterModule(modA, 1000);
    }
}
