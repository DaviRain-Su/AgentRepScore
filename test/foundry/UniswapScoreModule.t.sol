// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/UniswapScoreModule.sol";
import "../../contracts/interfaces/IEvidenceCommitment.sol";
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
        UniswapScoreModule.SwapSummary memory summary = _buildSwapSummary(
            swapCount, volumeUSD, netPnL, slippage, washTrade, counterpartyConcentration, timestamp, pool
        );
        _submitSummary(summary);
    }

    function _buildSwapSummary(
        uint256 swapCount,
        uint256 volumeUSD,
        int256 netPnL,
        uint256 slippage,
        bool washTrade,
        bool counterpartyConcentration,
        uint256 timestamp,
        address pool
    ) internal pure returns (UniswapScoreModule.SwapSummary memory) {
        return UniswapScoreModule.SwapSummary({
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
    }

    function _submitSummary(UniswapScoreModule.SwapSummary memory summary) internal {
        bytes memory sig = _signSwapSummary(keeperPrivateKey, wallet, summary);
        uniModule.submitSwapSummary(wallet, summary, sig);
    }

    function _buildCommitment(
        bytes32 root,
        bytes32 leafHash,
        bytes32 summaryHash,
        uint64 epoch,
        uint64 blockNumber,
        uint8 proofType
    ) internal pure returns (IEvidenceCommitment.EvidenceCommitment memory) {
        return IEvidenceCommitment.EvidenceCommitment({
            root: root,
            leafHash: leafHash,
            summaryHash: summaryHash,
            epoch: epoch,
            blockNumber: blockNumber,
            proofType: proofType
        });
    }

    function _submitCommitment(address wallet_, IEvidenceCommitment.EvidenceCommitment memory commitment) internal {
        vm.prank(keeper);
        uniModule.submitSwapCommitment(wallet_, commitment);
    }

    function _hashSwapSummary(UniswapScoreModule.SwapSummary memory summary) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                summary.swapCount,
                summary.volumeUSD,
                summary.netPnL,
                summary.avgSlippageBps,
                summary.feeToPnlRatioBps,
                summary.washTradeFlag,
                summary.counterpartyConcentrationFlag,
                summary.timestamp,
                summary.evidenceHash,
                summary.pool
            )
        );
    }

    function _hashSwapLeaf(address wallet_, uint64 epoch, uint64 blockNumber, bytes32 summaryHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("uniswap", wallet_, epoch, blockNumber, summaryHash));
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

    function test_SwapCommitmentCanBeWritten() public {
        IEvidenceCommitment.EvidenceCommitment memory commitment =
            _buildCommitment(keccak256("root-1"), keccak256("leaf-1"), keccak256("summary-1"), 1, 100, 1);

        _submitCommitment(wallet, commitment);

        IEvidenceCommitment.EvidenceCommitment memory stored = uniModule.getLatestSwapCommitment(wallet);
        assertEq(stored.root, commitment.root);
        assertEq(stored.leafHash, commitment.leafHash);
        assertEq(stored.summaryHash, commitment.summaryHash);
        assertEq(stored.epoch, commitment.epoch);
        assertEq(stored.blockNumber, commitment.blockNumber);
        assertEq(stored.proofType, commitment.proofType);
    }

    function test_SwapCommitmentCanBeOverwritten() public {
        IEvidenceCommitment.EvidenceCommitment memory first =
            _buildCommitment(keccak256("root-1"), keccak256("leaf-1"), keccak256("summary-1"), 1, 100, 1);
        IEvidenceCommitment.EvidenceCommitment memory second =
            _buildCommitment(keccak256("root-2"), keccak256("leaf-2"), keccak256("summary-2"), 2, 101, 2);

        _submitCommitment(wallet, first);
        _submitCommitment(wallet, second);

        IEvidenceCommitment.EvidenceCommitment memory stored = uniModule.getLatestSwapCommitment(wallet);
        assertEq(stored.root, second.root);
        assertEq(stored.leafHash, second.leafHash);
        assertEq(stored.summaryHash, second.summaryHash);
        assertEq(stored.epoch, second.epoch);
        assertEq(stored.blockNumber, second.blockNumber);
        assertEq(stored.proofType, second.proofType);
    }

    function test_SwapSummaryAndCommitmentCoexistWithoutChangingEvaluate() public {
        _submit(10, 5000e6, 1000e6, 5, false, false, block.timestamp, address(0));
        (int256 scoreBefore, uint256 confidenceBefore, bytes32 evidenceBefore) = uniModule.evaluate(wallet);
        IEvidenceCommitment.EvidenceCommitment memory commitment =
            _buildCommitment(keccak256("root-3"), keccak256("leaf-3"), keccak256("summary-3"), 3, 102, 1);
        _submitCommitment(wallet, commitment);

        (int256 scoreAfter, uint256 confidenceAfter, bytes32 evidenceAfter) = uniModule.evaluate(wallet);
        IEvidenceCommitment.EvidenceCommitment memory stored = uniModule.getLatestSwapCommitment(wallet);

        assertEq(scoreAfter, scoreBefore);
        assertEq(confidenceAfter, confidenceBefore);
        assertEq(evidenceAfter, evidenceBefore);
        assertEq(stored.root, commitment.root);
    }

    function test_AcceptSwapCommitment_ValidProof() public {
        UniswapScoreModule.SwapSummary memory summary =
            _buildSwapSummary(20, 20_000e6, 2_000e6, 6, false, false, block.timestamp, address(0));
        _submitSummary(summary);

        bytes32 summaryHash = _hashSwapSummary(summary);
        uint64 epoch = 1;
        uint64 blockNumber = uint64(block.number);
        bytes32 leafHash = _hashSwapLeaf(wallet, epoch, blockNumber, summaryHash);
        IEvidenceCommitment.EvidenceCommitment memory commitment =
            _buildCommitment(leafHash, leafHash, summaryHash, epoch, blockNumber, EvidenceProofType.MERKLE);
        _submitCommitment(wallet, commitment);

        vm.prank(keeper);
        uniModule.acceptSwapCommitment(wallet, new bytes32[](0));

        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted = uniModule.getAcceptedSwapCommitment(wallet);
        assertTrue(accepted.accepted);
        assertEq(accepted.root, leafHash);
        assertEq(accepted.leafHash, leafHash);
        assertEq(accepted.summaryHash, summaryHash);
        assertEq(accepted.epoch, epoch);
        assertEq(accepted.blockNumber, blockNumber);
        assertEq(accepted.proofType, EvidenceProofType.MERKLE);
        assertEq(accepted.verifiedAt, uint64(block.timestamp));
    }

    function test_AcceptSwapCommitment_InvalidProofReverts() public {
        UniswapScoreModule.SwapSummary memory summary =
            _buildSwapSummary(20, 20_000e6, 2_000e6, 6, false, false, block.timestamp, address(0));
        _submitSummary(summary);

        bytes32 summaryHash = _hashSwapSummary(summary);
        uint64 epoch = 1;
        uint64 blockNumber = uint64(block.number);
        bytes32 leafHash = _hashSwapLeaf(wallet, epoch, blockNumber, summaryHash);
        IEvidenceCommitment.EvidenceCommitment memory commitment = _buildCommitment(
            keccak256("bad-root"), leafHash, summaryHash, epoch, blockNumber, EvidenceProofType.MERKLE
        );
        _submitCommitment(wallet, commitment);

        vm.prank(keeper);
        vm.expectRevert(UniswapScoreModule.CommitmentProofInvalid.selector);
        uniModule.acceptSwapCommitment(wallet, new bytes32[](0));
    }

    function test_AcceptSwapCommitment_CanOverwriteAcceptance() public {
        UniswapScoreModule.SwapSummary memory firstSummary =
            _buildSwapSummary(20, 20_000e6, 2_000e6, 6, false, false, block.timestamp, address(0));
        _submitSummary(firstSummary);

        bytes32 firstSummaryHash = _hashSwapSummary(firstSummary);
        bytes32 firstLeafHash = _hashSwapLeaf(wallet, 1, uint64(block.number), firstSummaryHash);
        _submitCommitment(
            wallet,
            _buildCommitment(
                firstLeafHash, firstLeafHash, firstSummaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE
            )
        );
        vm.prank(keeper);
        uniModule.acceptSwapCommitment(wallet, new bytes32[](0));
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory firstAccepted =
            uniModule.getAcceptedSwapCommitment(wallet);

        UniswapScoreModule.SwapSummary memory secondSummary =
            _buildSwapSummary(30, 30_000e6, 3_000e6, 7, false, true, block.timestamp + 1, address(0));
        _submitSummary(secondSummary);

        bytes32 secondSummaryHash = _hashSwapSummary(secondSummary);
        bytes32 secondLeafHash = _hashSwapLeaf(wallet, 2, uint64(block.number), secondSummaryHash);
        _submitCommitment(
            wallet,
            _buildCommitment(
                secondLeafHash, secondLeafHash, secondSummaryHash, 2, uint64(block.number), EvidenceProofType.MERKLE
            )
        );
        vm.prank(keeper);
        uniModule.acceptSwapCommitment(wallet, new bytes32[](0));

        IEvidenceCommitment.EvidenceCommitmentAcceptance memory secondAccepted =
            uniModule.getAcceptedSwapCommitment(wallet);
        assertEq(secondAccepted.epoch, 2);
        assertEq(secondAccepted.summaryHash, secondSummaryHash);
        assertEq(secondAccepted.leafHash, secondLeafHash);
        assertGe(secondAccepted.verifiedAt, firstAccepted.verifiedAt);
    }

    function test_AcceptSwapCommitment_DoesNotChangeEvaluatePath() public {
        UniswapScoreModule.SwapSummary memory summary =
            _buildSwapSummary(20, 20_000e6, 2_000e6, 6, false, false, block.timestamp, address(0));
        _submitSummary(summary);
        (int256 scoreBefore, uint256 confidenceBefore, bytes32 evidenceBefore) = uniModule.evaluate(wallet);

        bytes32 summaryHash = _hashSwapSummary(summary);
        bytes32 leafHash = _hashSwapLeaf(wallet, 1, uint64(block.number), summaryHash);
        _submitCommitment(
            wallet, _buildCommitment(leafHash, leafHash, summaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE)
        );
        vm.prank(keeper);
        uniModule.acceptSwapCommitment(wallet, new bytes32[](0));

        (int256 scoreAfter, uint256 confidenceAfter, bytes32 evidenceAfter) = uniModule.evaluate(wallet);
        assertEq(scoreAfter, scoreBefore);
        assertEq(confidenceAfter, confidenceBefore);
        assertEq(evidenceAfter, evidenceBefore);
    }
}
