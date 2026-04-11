// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/BaseActivityModule.sol";
import "../../contracts/ScoreConstants.sol";

contract BaseActivityModuleTest is Test {
    BaseActivityModule baseModule;
    address governance = address(this);
    address keeper = address(0x999);
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        baseModule = new BaseActivityModule(governance);
        baseModule.setKeeper(keeper, true);
    }

    function _submit(uint256 txCount, uint256 firstTx, uint256 lastTx, uint256 counterparties, uint256 timestamp)
        internal
    {
        vm.prank(keeper);
        baseModule.submitActivitySummary(
            wallet,
            BaseActivityModule.ActivitySummary({
                txCount: txCount,
                firstTxTimestamp: firstTx,
                lastTxTimestamp: lastTx,
                uniqueCounterparties: counterparties,
                timestamp: timestamp,
                evidenceHash: keccak256("evidence")
            })
        );
    }

    function test_NoActivity() public view {
        (int256 score, uint256 confidence,) = baseModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_DataExpired() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp - 8 days);
        (int256 score, uint256 confidence,) = baseModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_NewWallet() public {
        _submit(20, block.timestamp - 60 days, block.timestamp, 5, block.timestamp);
        (int256 score,,) = baseModule.evaluate(wallet);
        // base 4000 + age 300 + txCount 300 + counterparties 300 = 4900
        assertEq(score, 4900);
    }

    function test_MatureActiveWallet() public {
        _submit(1200, block.timestamp - 400 days, block.timestamp, 60, block.timestamp);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 1500 + 1500 + 1500 = 8500
        assertEq(score, 8500);
    }

    function test_FewCounterparties() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 2, block.timestamp);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 800 + 800 - 1000 = 4600
        assertEq(score, 4600);
    }

    function test_LongInactivity() public {
        _submit(100, block.timestamp - 100 days, block.timestamp - 90 days, 10, block.timestamp);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 800 + 800 + 800 - 1500 = 4900. However firstTxTimestamp < block.timestamp - 90 days gives age=90 which is +800
        assertEq(score, 4900);
    }

    function test_MinScoreCap() public {
        _submit(1, block.timestamp - 10 days, block.timestamp - 365 days, 1, block.timestamp);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 - 1000(c counterparties) - 6000(inactivity ~365d) = -3000 (actual module minimum)
        assertEq(score, -3000);
    }

    function test_UnauthorizedKeeper() public {
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.UnauthorizedKeeper.selector, address(0xdead)));
        baseModule.submitActivitySummary(wallet, BaseActivityModule.ActivitySummary(0, 0, 0, 0, 0, 0));
    }

    function test_Pause_SubmitActivitySummaryBlocked() public {
        baseModule.pause();
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.ContractPaused.selector));
        baseModule.submitActivitySummary(wallet, BaseActivityModule.ActivitySummary(0, 0, 0, 0, 0, 0));
    }

    function test_Pause_Unpause() public {
        baseModule.pause();
        assertTrue(baseModule.paused());
        baseModule.unpause();
        assertFalse(baseModule.paused());
    }
}
