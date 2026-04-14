// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/UniswapScoreModule.sol";
import "../../contracts/ScoreConstants.sol";
import "../../contracts/lib/EIP712Lib.sol";
import "../../contracts/mocks/MockUniswapV3Pool.sol";

contract UniswapScoreModuleTest is Test {
    UniswapScoreModule uniModule;
    MockUniswapV3Pool mockPool;
    address governance = address(this);
    uint256 keeperPrivateKey = 0xaaa;
    address keeper;
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        keeper = vm.addr(keeperPrivateKey);
        uniModule = new UniswapScoreModule(governance);
        mockPool = new MockUniswapV3Pool();
        uniModule.setKeeper(keeper, true);
    }

    function _signSwapSummary(uint256 pk, address wallet_, UniswapScoreModule.SwapSummary memory summary)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                uniModule.SWAP_SUMMARY_TYPEHASH(),
                wallet_,
                summary.swapCount,
                summary.volumeUSD,
                summary.netPnL,
                summary.avgSlippageBps,
                summary.feeToPnlRatioBps,
                summary.washTradeFlag,
                summary.counterpartyConcentrationFlag,
                summary.timestamp,
                summary.evidenceHash,
                summary.pool,
                uniModule.nonces(wallet_)
            )
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(
            EIP712Lib.domainSeparator("UniswapScoreModule", "1", address(uniModule)), structHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }

    function _submit(
        uint256 swapCount,
        uint256 volumeUSD,
        int256 netPnL,
        uint256 slippage,
        bool washTrade,
        bool counterpartyConcentration,
        uint256 timestamp,
        address pool
    ) internal {
        UniswapScoreModule.SwapSummary memory summary = UniswapScoreModule.SwapSummary({
            swapCount: swapCount,
            volumeUSD: volumeUSD,
            netPnL: netPnL,
            avgSlippageBps: slippage,
            feeToPnlRatioBps: 0,
            washTradeFlag: washTrade,
            counterpartyConcentrationFlag: counterpartyConcentration,
            timestamp: timestamp,
            evidenceHash: keccak256("evidence"),
            pool: pool
        });
        bytes memory sig = _signSwapSummary(keeperPrivateKey, wallet, summary);
        uniModule.submitSwapSummary(wallet, summary, sig);
    }

    function test_NoHistory() public view {
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_DataExpired() public {
        _submit(10, 1000e6, 100e6, 5, false, false, block.timestamp - 8 days, address(0));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_NormalData() public {
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(0));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertGt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        assertEq(confidence, 100);
    }

    function test_HighVolumeLowSlippage() public {
        _submit(50, 200_000e6, 5000e6, 5, false, false, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        assertApproxEqAbs(score, 9000, 500);
    }

    function test_LargeLoss() public {
        _submit(10, 5000e6, -20_000e6, 5, false, false, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        assertLt(score, ScoreConstants.BASE_UNISWAP_SCORE);
    }

    function test_WashTradePenalty() public {
        _submit(10, 5000e6, 1000e6, 5, true, false, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        assertLt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        // base 5000 + 300(volume) + 1500(pnl) + 1000(slippage) - 3000(wash) = 4800
        assertEq(score, 4800);
    }

    function test_CounterpartyConcentrationPenalty() public {
        _submit(10, 5000e6, 1000e6, 5, false, true, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        // base 5000 + 300(volume) + 1500(pnl) + 1000(slippage) - 1500(conc) = 6300
        assertEq(score, 6300);
    }

    function test_MaxScoreCap() public {
        // base 5000 + volume 1500 + pnl 1500 + slippage 1000 + wash 0 = 9000 (max for this algo)
        _submit(100, 200_000e6, 10_000e6, 5, false, false, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        assertEq(score, 9000);
    }

    function test_MinScoreCap() public {
        // base 5000 + volume 0 + pnl -2000 + slippage -500 + wash -3000 = -500
        // Can't reach MIN_SCORE with current thresholds
        _submit(1, 0, -50_000e6, 100, true, false, block.timestamp, address(0));
        (int256 score,,) = uniModule.evaluate(wallet);
        assertEq(score, -500);
    }

    function test_UnauthorizedKeeper() public {
        UniswapScoreModule.SwapSummary memory summary =
            UniswapScoreModule.SwapSummary(0, 0, 0, 0, 0, false, false, 0, 0, address(0));
        bytes memory badSig = _signSwapSummary(0xdeadbeef, wallet, summary);
        vm.expectRevert(abi.encodeWithSelector(UniswapScoreModule.UnauthorizedKeeper.selector, vm.addr(0xdeadbeef)));
        uniModule.submitSwapSummary(wallet, summary, badSig);
    }

    function test_Pause_SubmitSwapSummaryBlocked() public {
        uniModule.pause();
        UniswapScoreModule.SwapSummary memory summary =
            UniswapScoreModule.SwapSummary(0, 0, 0, 0, 0, false, false, 0, 0, address(0));
        bytes memory sig = _signSwapSummary(keeperPrivateKey, wallet, summary);
        vm.expectRevert(abi.encodeWithSelector(UniswapScoreModule.ContractPaused.selector));
        uniModule.submitSwapSummary(wallet, summary, sig);
    }

    function test_Pause_Unpause() public {
        uniModule.pause();
        assertTrue(uniModule.paused());
        uniModule.unpause();
        assertFalse(uniModule.paused());
    }

    // --- Slot0 price sanity check tests ---

    function test_Slot0PriceSane() public {
        uint160 ref = uint160(2 ** 96);
        mockPool.setSqrtPriceX96(ref);
        uniModule.setReferenceSqrtPriceX96(address(mockPool), ref);
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(mockPool));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertGt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        assertEq(confidence, 100);
    }

    function test_Slot0PriceDeviationRejects() public {
        uint160 ref = uint160(2 ** 96);
        // 12% higher sqrt price (> 10% threshold) should reject
        uint160 current = uint160((uint256(ref) * 11200) / 10000);
        mockPool.setSqrtPriceX96(current);
        uniModule.setReferenceSqrtPriceX96(address(mockPool), ref);
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(mockPool));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_Slot0PriceDeviationLowSideRejects() public {
        uint160 ref = uint160(2 ** 96);
        // 12% lower sqrt price should reject
        uint160 current = uint160((uint256(ref) * 8800) / 10000);
        mockPool.setSqrtPriceX96(current);
        uniModule.setReferenceSqrtPriceX96(address(mockPool), ref);
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(mockPool));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_NoPoolSkipsCheck() public {
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(0));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertGt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        assertEq(confidence, 100);
    }

    function test_NoReferencePriceSkipsCheck() public {
        mockPool.setSqrtPriceX96(uint160(2 ** 96));
        // reference not set
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(mockPool));
        (int256 score, uint256 confidence,) = uniModule.evaluate(wallet);
        assertGt(score, ScoreConstants.BASE_UNISWAP_SCORE);
        assertEq(confidence, 100);
    }
}
