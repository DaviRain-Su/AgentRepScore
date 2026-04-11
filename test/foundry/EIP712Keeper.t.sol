// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/UniswapScoreModule.sol";
import "../../contracts/modules/BaseActivityModule.sol";
import "../../contracts/modules/AaveScoreModule.sol";
import "../../contracts/mocks/MockAavePool.sol";
import "../../contracts/lib/EIP712Lib.sol";

contract EIP712KeeperTest is Test {
    UniswapScoreModule uni;
    BaseActivityModule base;
    AaveScoreModule aave;
    MockAavePool mockPool;

    address governance = address(this);
    uint256 keeperPk = 0xabc123;
    address keeper = vm.addr(keeperPk);
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        uni = new UniswapScoreModule(governance);
        base = new BaseActivityModule(governance);
        mockPool = new MockAavePool();
        aave = new AaveScoreModule(address(mockPool), governance);

        uni.setKeeper(keeper, true);
        base.setKeeper(keeper, true);
        aave.setKeeper(keeper, true);
    }

    // --- Uniswap ---
    function test_Uniswap_ValidSignature() public {
        UniswapScoreModule.SwapSummary memory summary =
            UniswapScoreModule.SwapSummary(1, 100, 10, 5, 0, false, false, block.timestamp, keccak256("evidence"), address(0));
        bytes memory sig = _signSwapSummary(keeperPk, wallet, summary);
        uni.submitSwapSummary(wallet, summary, sig);
        (uint256 swapCount,,,,,,,,,) = uni.latestSwapSummary(wallet);
        assertEq(swapCount, 1);
    }

    function test_Uniswap_InvalidSignatureReverts() public {
        UniswapScoreModule.SwapSummary memory summary =
            UniswapScoreModule.SwapSummary(1, 100, 10, 5, 0, false, false, block.timestamp, keccak256("evidence"), address(0));
        bytes memory sig = _signSwapSummary(0xdead, wallet, summary); // wrong signer
        vm.expectRevert(abi.encodeWithSelector(UniswapScoreModule.UnauthorizedKeeper.selector, vm.addr(0xdead)));
        uni.submitSwapSummary(wallet, summary, sig);
    }

    // --- BaseActivity ---
    function test_BaseActivity_ValidSignature() public {
        BaseActivityModule.ActivitySummary memory summary = BaseActivityModule.ActivitySummary(
            10, block.timestamp - 100, block.timestamp, 5, block.timestamp, keccak256("evidence")
        );
        bytes memory sig = _signActivitySummary(keeperPk, wallet, summary);
        base.submitActivitySummary(wallet, summary, sig);
        (uint256 txCount,,,,,) = base.latestActivitySummary(wallet);
        assertEq(txCount, 10);
    }

    function test_BaseActivity_InvalidSignatureReverts() public {
        BaseActivityModule.ActivitySummary memory summary = BaseActivityModule.ActivitySummary(
            10, block.timestamp - 100, block.timestamp, 5, block.timestamp, keccak256("evidence")
        );
        bytes memory sig = _signActivitySummary(0xbad, wallet, summary);
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.UnauthorizedKeeper.selector, vm.addr(0xbad)));
        base.submitActivitySummary(wallet, summary, sig);
    }

    // --- Aave ---
    function test_Aave_ValidSignature() public {
        bytes memory sig = _signWalletMeta(keeperPk, wallet, 1, 2, block.timestamp);
        aave.submitWalletMeta(wallet, 1, 2, block.timestamp, sig);
        (uint256 liquidationCount,,) = aave.walletMeta(wallet);
        assertEq(liquidationCount, 1);
    }

    function test_Aave_InvalidSignatureReverts() public {
        bytes memory sig = _signWalletMeta(0xbad, wallet, 1, 2, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(AaveScoreModule.UnauthorizedKeeper.selector, vm.addr(0xbad)));
        aave.submitWalletMeta(wallet, 1, 2, block.timestamp, sig);
    }

    // --- Helpers ---
    function _signSwapSummary(uint256 pk, address wallet_, UniswapScoreModule.SwapSummary memory summary)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                uni.SWAP_SUMMARY_TYPEHASH(),
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
                uni.nonces(wallet_)
            )
        );
        bytes32 digest =
            EIP712Lib.toTypedDataHash(EIP712Lib.domainSeparator("UniswapScoreModule", "1", address(uni)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }

    function _signActivitySummary(uint256 pk, address wallet_, BaseActivityModule.ActivitySummary memory summary)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                base.ACTIVITY_SUMMARY_TYPEHASH(),
                wallet_,
                summary.txCount,
                summary.firstTxTimestamp,
                summary.lastTxTimestamp,
                summary.uniqueCounterparties,
                summary.timestamp,
                summary.evidenceHash,
                base.nonces(wallet_)
            )
        );
        bytes32 digest =
            EIP712Lib.toTypedDataHash(EIP712Lib.domainSeparator("BaseActivityModule", "1", address(base)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }

    function _signWalletMeta(
        uint256 pk,
        address wallet_,
        uint256 liquidationCount,
        uint256 suppliedAssetCount,
        uint256 timestamp
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                aave.WALLET_META_TYPEHASH(),
                wallet_,
                liquidationCount,
                suppliedAssetCount,
                timestamp,
                aave.nonces(wallet_)
            )
        );
        bytes32 digest =
            EIP712Lib.toTypedDataHash(EIP712Lib.domainSeparator("AaveScoreModule", "1", address(aave)), structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }
}
