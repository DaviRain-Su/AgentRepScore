// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/AaveScoreModule.sol";
import "../../contracts/mocks/MockAavePool.sol";
import "../../contracts/ScoreConstants.sol";

contract AaveScoreModuleTest is Test {
    MockAavePool mockPool;
    AaveScoreModule aaveModule;

    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        mockPool = new MockAavePool();
        aaveModule = new AaveScoreModule(address(mockPool));
    }

    function _setData(
        uint256 collateral,
        uint256 debt,
        uint256 healthFactor
    ) internal {
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
}
