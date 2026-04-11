// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/UniswapScoreModule.sol";
import "../../contracts/ScoreConstants.sol";

contract UniswapScoreModuleTest is Test {
    UniswapScoreModule uniModule;
    address governance = address(this);
    address keeper = address(0x999);
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        uniModule = new UniswapScoreModule(governance);
        uniModule.setKeeper(keeper, true);
    }

    function _submit(
        uint256 swapCount,
        uint256 volumeUSD,
        int256 netPnL,
        uint256 slippage,
        bool washTrade,
        uint256 timestamp
    ) internal {
        vm.prank(keeper);
        uniModule.submitSwapSummary(
            wallet,
            UniswapScoreModule.SwapSummary({
                swapCount: swapCount,
                volumeUSD: volumeUSD,
                netPnL: netPnL,
                avgSlippageBps: slippage,
                feeToPnlRatioBps: 0,
                washTradeFlag: washTrade,
                timestamp: timestamp,
                evidenceHash: keccak256("evidence")
            })
        );
    }

    function test_NoHistory() public view {
        (int256 score, uint256 confidence, ) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_DataExpired() public {
        _submit(10, 1000e6, 100e6, 5, false, block.timestamp - 8 days);
        (int256 score, uint256 confidence, ) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_NormalData() public {
        _submit(10, 5000e6, 1000e6, 5, false, block.timestamp);
        (int256 score, uint256 confidence, ) = uniModule.evaluate(wallet);
        assertGt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        assertEq(confidence, 100);
    }

    function test_HighVolumeLowSlippage() public {
        _submit(50, 200_000e6, 5000e6, 5, false, block.timestamp);
        (int256 score, , ) = uniModule.evaluate(wallet);
        assertApproxEqAbs(score, 9000, 500);
    }

    function test_LargeLoss() public {
        _submit(10, 5000e6, -20_000e6, 5, false, block.timestamp);
        (int256 score, , ) = uniModule.evaluate(wallet);
        assertLt(score, ScoreConstants.BASE_UNISWAP_SCORE);
    }

    function test_WashTradePenalty() public {
        _submit(10, 5000e6, 1000e6, 5, true, block.timestamp);
        (int256 score, , ) = uniModule.evaluate(wallet);
        assertLt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        // base 5000 + 300(volume) + 1500(pnl) + 1000(slippage) - 3000(wash) = 4800
        assertEq(score, 4800);
    }

    function test_MaxScoreCap() public {
        // base 5000 + volume 1500 + pnl 1500 + slippage 1000 + wash 0 = 9000 (max for this algo)
        _submit(100, 200_000e6, 10_000e6, 5, false, block.timestamp);
        (int256 score, , ) = uniModule.evaluate(wallet);
        assertEq(score, 9000);
    }

    function test_MinScoreCap() public {
        // base 5000 + volume 0 + pnl -2000 + slippage -500 + wash -3000 = -500
        // Can't reach MIN_SCORE with current thresholds
        _submit(1, 0, -50_000e6, 100, true, block.timestamp);
        (int256 score, , ) = uniModule.evaluate(wallet);
        assertEq(score, -500);
    }

    function test_UnauthorizedKeeper() public {
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(UniswapScoreModule.UnauthorizedKeeper.selector, address(0xdead)));
        uniModule.submitSwapSummary(wallet, UniswapScoreModule.SwapSummary(0, 0, 0, 0, 0, false, 0, 0));
    }
}
