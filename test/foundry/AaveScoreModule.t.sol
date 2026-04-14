// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/AaveScoreModule.sol";
import "../../contracts/mocks/MockAavePool.sol";
import "../../contracts/ScoreConstants.sol";
import "../../contracts/lib/EIP712Lib.sol";

contract AaveScoreModuleTest is Test {
    MockAavePool mockPool;
    AaveScoreModule aaveModule;

    address governance = address(this);
    uint256 keeperPrivateKey = 0xaaa;
    address keeper;
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        mockPool = new MockAavePool();
        keeper = vm.addr(keeperPrivateKey);
        aaveModule = new AaveScoreModule(address(mockPool), governance);
        aaveModule.setKeeper(keeper, true);
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
                aaveModule.WALLET_META_TYPEHASH(),
                wallet_,
                liquidationCount,
                suppliedAssetCount,
                timestamp,
                aaveModule.nonces(wallet_)
            )
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(
            EIP712Lib.domainSeparator("AaveScoreModule", "1", address(aaveModule)), structHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }

    function _setData(uint256 collateral, uint256 debt, uint256 healthFactor) internal {
        mockPool.setUserAccountData(wallet, collateral, debt, 0, 0, 0, healthFactor);
    }

    function test_NoActivity() public {
        _setData(0, 0, 1e18);
        (int256 score, uint256 confidence,) = aaveModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_HealthFactorExcellent() public {
        _setData(1000e8, 500e8, 25e17);
        (int256 score,,) = aaveModule.evaluate(wallet);
        // utilization=50% gives +1000
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 2500 + 1000);
    }

    function test_HealthFactorGood() public {
        _setData(1000e8, 500e8, 16e17);
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 1500 + 1000);
    }

    function test_HealthFactorMin() public {
        _setData(1000e8, 500e8, 11e17);
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 500 + 1000);
    }

    function test_HealthFactorDangerous() public {
        _setData(1000e8, 500e8, 9e17);
        (int256 score,,) = aaveModule.evaluate(wallet);
        // utilization=50% gives +1000, healthFactor < 1.0 gives -3000
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE - 3000 + 1000);
    }

    function test_UtilizationIdeal() public {
        _setData(1000e8, 500e8, 2e18);
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 2500 + 1000);
    }

    function test_UtilizationHigh() public {
        _setData(1000e8, 850e8, 2e18);
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 2500 - 500);
    }

    function test_MaxScoreCap() public {
        _setData(1000e8, 500e8, 2e18);
        // This ideal scenario gives 5000 + 2500 + 1000 + 0 (assetCount defaults to 1) = 8500
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertLe(score, ScoreConstants.MAX_SCORE);
    }

    function test_MinScoreCap() public {
        _setData(1000e8, 900e8, 5e17);
        // Dangerous health factor: 5000 - 3000 = 2000
        // High utilization could subtract another 500 -> 1500
        // Well above MIN_SCORE since liquidationCount defaults to 0
        (int256 score,,) = aaveModule.evaluate(wallet);
        assertGe(score, ScoreConstants.MIN_SCORE);
    }

    function test_LiquidationCountPenalty() public {
        _setData(1000e8, 500e8, 2e18);
        bytes memory sig = _signWalletMeta(keeperPrivateKey, wallet, 2, 1, block.timestamp);
        aaveModule.submitWalletMeta(wallet, 2, 1, block.timestamp, sig); // 2 liquidations, 1 asset
        (int256 score,,) = aaveModule.evaluate(wallet);
        // 5000 + 2500 + 1000 - (2 * 1500) = 5500
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 2500 + 1000 - 3000);
    }

    function test_AssetCountBonus() public {
        _setData(1000e8, 500e8, 2e18);
        bytes memory sig = _signWalletMeta(keeperPrivateKey, wallet, 0, 3, block.timestamp);
        aaveModule.submitWalletMeta(wallet, 0, 3, block.timestamp, sig); // 0 liquidations, 3 assets
        (int256 score,,) = aaveModule.evaluate(wallet);
        // 5000 + 2500 + 1000 + 1000 = 9500
        assertEq(score, ScoreConstants.BASE_AAVE_SCORE + 2500 + 1000 + 1000);
    }

    function test_UnauthorizedKeeper() public {
        bytes memory badSig = _signWalletMeta(0xdeadbeef, wallet, 0, 1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(AaveScoreModule.UnauthorizedKeeper.selector, vm.addr(0xdeadbeef)));
        aaveModule.submitWalletMeta(wallet, 0, 1, block.timestamp, badSig);
    }

    function test_GovernanceTransfer() public {
        address newGov = address(0xabcd);
        aaveModule.initiateGovernanceTransfer(newGov);
        vm.prank(newGov);
        aaveModule.acceptGovernanceTransfer();
        assertEq(aaveModule.governance(), newGov);
    }

    function test_Pause_SubmitWalletMetaBlocked() public {
        aaveModule.pause();
        bytes memory sig = _signWalletMeta(keeperPrivateKey, wallet, 0, 1, block.timestamp);
        vm.expectRevert(abi.encodeWithSelector(AaveScoreModule.ContractPaused.selector));
        aaveModule.submitWalletMeta(wallet, 0, 1, block.timestamp, sig);
    }

    function test_Pause_Unpause() public {
        aaveModule.pause();
        assertTrue(aaveModule.paused());
        aaveModule.unpause();
        assertFalse(aaveModule.paused());
    }
}
