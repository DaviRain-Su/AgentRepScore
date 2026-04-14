// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/modules/BaseActivityModule.sol";
import "../../contracts/interfaces/IEvidenceCommitment.sol";
import "../../contracts/ScoreConstants.sol";
import "../../contracts/lib/EIP712Lib.sol";

contract BaseActivityModuleTest is Test {
    BaseActivityModule baseModule;
    address governance = address(this);
    uint256 keeperPrivateKey = 0xaaa;
    address keeper;
    address wallet = address(0x1234);

    function setUp() public {
        vm.warp(1_700_000_000);
        keeper = vm.addr(keeperPrivateKey);
        baseModule = new BaseActivityModule(governance);
        baseModule.setKeeper(keeper, true);
    }

    function _signActivitySummary(uint256 pk, address wallet_, BaseActivityModule.ActivitySummary memory summary)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                baseModule.ACTIVITY_SUMMARY_TYPEHASH(),
                wallet_,
                summary.txCount,
                summary.firstTxTimestamp,
                summary.lastTxTimestamp,
                summary.uniqueCounterparties,
                summary.timestamp,
                summary.evidenceHash,
                summary.sybilClusterFlag,
                baseModule.nonces(wallet_)
            )
        );
        bytes32 digest = EIP712Lib.toTypedDataHash(
            EIP712Lib.domainSeparator("BaseActivityModule", "1", address(baseModule)), structHash
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        if (v < 27) v += 27;
        return abi.encodePacked(r, s, v);
    }

    function _submit(
        uint256 txCount,
        uint256 firstTx,
        uint256 lastTx,
        uint256 counterparties,
        uint256 timestamp,
        bool sybilClusterFlag
    ) internal {
        BaseActivityModule.ActivitySummary memory summary = _buildActivitySummary(
            txCount, firstTx, lastTx, counterparties, timestamp, sybilClusterFlag
        );
        _submitSummary(summary);
    }

    function _buildActivitySummary(
        uint256 txCount,
        uint256 firstTx,
        uint256 lastTx,
        uint256 counterparties,
        uint256 timestamp,
        bool sybilClusterFlag
    ) internal pure returns (BaseActivityModule.ActivitySummary memory) {
        return BaseActivityModule.ActivitySummary({
            txCount: txCount,
            firstTxTimestamp: firstTx,
            lastTxTimestamp: lastTx,
            uniqueCounterparties: counterparties,
            timestamp: timestamp,
            evidenceHash: keccak256("evidence"),
            sybilClusterFlag: sybilClusterFlag
        });
    }

    function _submitSummary(BaseActivityModule.ActivitySummary memory summary) internal {
        bytes memory sig = _signActivitySummary(keeperPrivateKey, wallet, summary);
        baseModule.submitActivitySummary(wallet, summary, sig);
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
        baseModule.submitActivityCommitment(wallet_, commitment);
    }

    function _hashActivitySummary(BaseActivityModule.ActivitySummary memory summary) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                summary.txCount,
                summary.firstTxTimestamp,
                summary.lastTxTimestamp,
                summary.uniqueCounterparties,
                summary.timestamp,
                summary.evidenceHash,
                summary.sybilClusterFlag
            )
        );
    }

    function _hashActivityLeaf(address wallet_, uint64 epoch, uint64 blockNumber, bytes32 summaryHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("activity", wallet_, epoch, blockNumber, summaryHash));
    }

    function test_NoActivity() public view {
        (int256 score, uint256 confidence,) = baseModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_DataExpired() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp - 8 days, false);
        (int256 score, uint256 confidence,) = baseModule.evaluate(wallet);
        assertEq(score, 0);
        assertEq(confidence, 0);
    }

    function test_NewWallet() public {
        _submit(20, block.timestamp - 60 days, block.timestamp, 5, block.timestamp, false);
        (int256 score,,) = baseModule.evaluate(wallet);
        // base 4000 + age 300 + txCount 300 + counterparties 300 = 4900
        assertEq(score, 4900);
    }

    function test_MatureActiveWallet() public {
        _submit(1200, block.timestamp - 400 days, block.timestamp, 60, block.timestamp, false);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 1500 + 1500 + 1500 = 8500
        assertEq(score, 8500);
    }

    function test_FewCounterparties() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 2, block.timestamp, false);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 800 + 800 - 1000 = 4600
        assertEq(score, 4600);
    }

    function test_LongInactivity() public {
        _submit(100, block.timestamp - 100 days, block.timestamp - 90 days, 10, block.timestamp, false);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 + 800 + 800 + 800 - 1500 = 4900. However firstTxTimestamp < block.timestamp - 90 days gives age=90 which is +800
        assertEq(score, 4900);
    }

    function test_MinScoreCap() public {
        _submit(1, block.timestamp - 10 days, block.timestamp - 365 days, 1, block.timestamp, false);
        (int256 score,,) = baseModule.evaluate(wallet);
        // 4000 - 1000(c counterparties) - 6000(inactivity ~365d) = -3000 (actual module minimum)
        assertEq(score, -3000);
    }

    function test_UnauthorizedKeeper() public {
        BaseActivityModule.ActivitySummary memory summary = BaseActivityModule.ActivitySummary(0, 0, 0, 0, 0, 0, false);
        bytes memory badSig = _signActivitySummary(0xdeadbeef, wallet, summary);
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.UnauthorizedKeeper.selector, vm.addr(0xdeadbeef)));
        baseModule.submitActivitySummary(wallet, summary, badSig);
    }

    function test_Pause_SubmitActivitySummaryBlocked() public {
        baseModule.pause();
        BaseActivityModule.ActivitySummary memory summary = BaseActivityModule.ActivitySummary(0, 0, 0, 0, 0, 0, false);
        bytes memory sig = _signActivitySummary(keeperPrivateKey, wallet, summary);
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.ContractPaused.selector));
        baseModule.submitActivitySummary(wallet, summary, sig);
    }

    function test_Pause_Unpause() public {
        baseModule.pause();
        assertTrue(baseModule.paused());
        baseModule.unpause();
        assertFalse(baseModule.paused());
    }

    function test_SybilClusterPenalty() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, true);
        (int256 score,,) = baseModule.evaluate(wallet);
        // Same as mature wallet without penalty: 4000 + 800 + 800 + 800 = 6400, minus 2000 sybil penalty = 4400
        assertEq(score, 4400);
    }

    function test_ActivityCommitmentCanBeWritten() public {
        IEvidenceCommitment.EvidenceCommitment memory commitment =
            _buildCommitment(keccak256("root-1"), keccak256("leaf-1"), keccak256("summary-1"), 1, 100, 1);

        _submitCommitment(wallet, commitment);

        IEvidenceCommitment.EvidenceCommitment memory stored = baseModule.getLatestActivityCommitment(wallet);
        assertEq(stored.root, commitment.root);
        assertEq(stored.leafHash, commitment.leafHash);
        assertEq(stored.summaryHash, commitment.summaryHash);
        assertEq(stored.epoch, commitment.epoch);
        assertEq(stored.blockNumber, commitment.blockNumber);
        assertEq(stored.proofType, commitment.proofType);
    }

    function test_ActivityCommitmentCanBeOverwritten() public {
        IEvidenceCommitment.EvidenceCommitment memory first =
            _buildCommitment(keccak256("root-1"), keccak256("leaf-1"), keccak256("summary-1"), 1, 100, 1);
        IEvidenceCommitment.EvidenceCommitment memory second =
            _buildCommitment(keccak256("root-2"), keccak256("leaf-2"), keccak256("summary-2"), 2, 101, 2);

        _submitCommitment(wallet, first);
        _submitCommitment(wallet, second);

        IEvidenceCommitment.EvidenceCommitment memory stored = baseModule.getLatestActivityCommitment(wallet);
        assertEq(stored.root, second.root);
        assertEq(stored.leafHash, second.leafHash);
        assertEq(stored.summaryHash, second.summaryHash);
        assertEq(stored.epoch, second.epoch);
        assertEq(stored.blockNumber, second.blockNumber);
        assertEq(stored.proofType, second.proofType);
    }

    function test_ActivitySummaryAndCommitmentCoexistWithoutChangingEvaluate() public {
        _submit(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        (int256 scoreBefore, uint256 confidenceBefore, bytes32 evidenceBefore) = baseModule.evaluate(wallet);
        IEvidenceCommitment.EvidenceCommitment memory commitment =
            _buildCommitment(keccak256("root-3"), keccak256("leaf-3"), keccak256("summary-3"), 3, 102, 1);
        _submitCommitment(wallet, commitment);

        (int256 scoreAfter, uint256 confidenceAfter, bytes32 evidenceAfter) = baseModule.evaluate(wallet);
        IEvidenceCommitment.EvidenceCommitment memory stored = baseModule.getLatestActivityCommitment(wallet);

        assertEq(scoreAfter, scoreBefore);
        assertEq(confidenceAfter, confidenceBefore);
        assertEq(evidenceAfter, evidenceBefore);
        assertEq(stored.root, commitment.root);
    }

    function test_AcceptActivityCommitment_ValidProof() public {
        BaseActivityModule.ActivitySummary memory summary =
            _buildActivitySummary(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        _submitSummary(summary);

        bytes32 summaryHash = _hashActivitySummary(summary);
        uint64 epoch = 1;
        uint64 blockNumber = uint64(block.number);
        bytes32 leafHash = _hashActivityLeaf(wallet, epoch, blockNumber, summaryHash);
        _submitCommitment(
            wallet, _buildCommitment(leafHash, leafHash, summaryHash, epoch, blockNumber, EvidenceProofType.MERKLE)
        );

        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));

        IEvidenceCommitment.EvidenceCommitmentAcceptance memory accepted =
            baseModule.getAcceptedActivityCommitment(wallet);
        assertTrue(accepted.accepted);
        assertEq(accepted.root, leafHash);
        assertEq(accepted.leafHash, leafHash);
        assertEq(accepted.summaryHash, summaryHash);
        assertEq(accepted.epoch, epoch);
        assertEq(accepted.blockNumber, blockNumber);
        assertEq(accepted.proofType, EvidenceProofType.MERKLE);
        assertEq(accepted.verifiedAt, uint64(block.timestamp));
    }

    function test_AcceptActivityCommitment_InvalidLeafReverts() public {
        BaseActivityModule.ActivitySummary memory summary =
            _buildActivitySummary(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        _submitSummary(summary);

        bytes32 summaryHash = _hashActivitySummary(summary);
        bytes32 badLeaf = keccak256("bad-leaf");
        _submitCommitment(
            wallet, _buildCommitment(badLeaf, badLeaf, summaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE)
        );

        bytes32 expectedLeaf = _hashActivityLeaf(wallet, 1, uint64(block.number), summaryHash);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(BaseActivityModule.LeafHashMismatch.selector, expectedLeaf, badLeaf));
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));
    }

    function test_AcceptActivityCommitment_CanOverwriteAcceptance() public {
        BaseActivityModule.ActivitySummary memory firstSummary =
            _buildActivitySummary(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        _submitSummary(firstSummary);
        bytes32 firstSummaryHash = _hashActivitySummary(firstSummary);
        bytes32 firstLeafHash = _hashActivityLeaf(wallet, 1, uint64(block.number), firstSummaryHash);
        _submitCommitment(
            wallet,
            _buildCommitment(
                firstLeafHash, firstLeafHash, firstSummaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE
            )
        );
        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));
        IEvidenceCommitment.EvidenceCommitmentAcceptance memory firstAccepted =
            baseModule.getAcceptedActivityCommitment(wallet);

        BaseActivityModule.ActivitySummary memory secondSummary =
            _buildActivitySummary(200, block.timestamp - 200 days, block.timestamp, 20, block.timestamp + 1, true);
        _submitSummary(secondSummary);
        bytes32 secondSummaryHash = _hashActivitySummary(secondSummary);
        bytes32 secondLeafHash = _hashActivityLeaf(wallet, 2, uint64(block.number), secondSummaryHash);
        _submitCommitment(
            wallet,
            _buildCommitment(
                secondLeafHash, secondLeafHash, secondSummaryHash, 2, uint64(block.number), EvidenceProofType.MERKLE
            )
        );
        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));

        IEvidenceCommitment.EvidenceCommitmentAcceptance memory secondAccepted =
            baseModule.getAcceptedActivityCommitment(wallet);
        assertEq(secondAccepted.epoch, 2);
        assertEq(secondAccepted.summaryHash, secondSummaryHash);
        assertEq(secondAccepted.leafHash, secondLeafHash);
        assertGe(secondAccepted.verifiedAt, firstAccepted.verifiedAt);
    }

    function test_AcceptActivityCommitment_DoesNotChangeEvaluatePath() public {
        BaseActivityModule.ActivitySummary memory summary =
            _buildActivitySummary(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        _submitSummary(summary);
        (int256 scoreBefore, uint256 confidenceBefore, bytes32 evidenceBefore) = baseModule.evaluate(wallet);

        bytes32 summaryHash = _hashActivitySummary(summary);
        bytes32 leafHash = _hashActivityLeaf(wallet, 1, uint64(block.number), summaryHash);
        _submitCommitment(
            wallet, _buildCommitment(leafHash, leafHash, summaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE)
        );
        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));

        (int256 scoreAfter, uint256 confidenceAfter, bytes32 evidenceAfter) = baseModule.evaluate(wallet);
        assertEq(scoreAfter, scoreBefore);
        assertEq(confidenceAfter, confidenceBefore);
        assertEq(evidenceAfter, evidenceBefore);
    }

    function test_Evaluate_PrefersAcceptedActivitySummaryOverLatestUnacceptedSummary() public {
        BaseActivityModule.ActivitySummary memory acceptedSummary =
            _buildActivitySummary(1200, block.timestamp - 400 days, block.timestamp, 60, block.timestamp, false);
        acceptedSummary.evidenceHash = keccak256("accepted-activity");
        _submitSummary(acceptedSummary);

        bytes32 summaryHash = _hashActivitySummary(acceptedSummary);
        bytes32 leafHash = _hashActivityLeaf(wallet, 1, uint64(block.number), summaryHash);
        _submitCommitment(
            wallet, _buildCommitment(leafHash, leafHash, summaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE)
        );
        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));

        (int256 acceptedScore, uint256 acceptedConfidence, bytes32 acceptedEvidence) = baseModule.evaluate(wallet);

        BaseActivityModule.ActivitySummary memory latestUnaccepted = _buildActivitySummary(
            1, block.timestamp - 10 days, block.timestamp - 365 days, 1, block.timestamp + 1, true
        );
        latestUnaccepted.evidenceHash = keccak256("latest-unaccepted-activity");
        _submitSummary(latestUnaccepted);

        (int256 scoreAfter, uint256 confidenceAfter, bytes32 evidenceAfter) = baseModule.evaluate(wallet);

        assertEq(scoreAfter, acceptedScore);
        assertEq(confidenceAfter, acceptedConfidence);
        assertEq(evidenceAfter, acceptedEvidence);
        assertEq(evidenceAfter, acceptedSummary.evidenceHash);
        assertTrue(evidenceAfter != latestUnaccepted.evidenceHash);
    }

    function test_Evaluate_FallsBackToLatestWhenAcceptedActivitySummaryIsStale() public {
        BaseActivityModule.ActivitySummary memory acceptedSummary =
            _buildActivitySummary(1200, block.timestamp - 400 days, block.timestamp, 60, block.timestamp, false);
        acceptedSummary.evidenceHash = keccak256("stale-accepted-activity");
        _submitSummary(acceptedSummary);

        bytes32 summaryHash = _hashActivitySummary(acceptedSummary);
        bytes32 leafHash = _hashActivityLeaf(wallet, 1, uint64(block.number), summaryHash);
        _submitCommitment(
            wallet, _buildCommitment(leafHash, leafHash, summaryHash, 1, uint64(block.number), EvidenceProofType.MERKLE)
        );
        vm.prank(keeper);
        baseModule.acceptActivityCommitment(wallet, new bytes32[](0));

        vm.warp(block.timestamp + ScoreConstants.DATA_STALE_WINDOW + 1);

        BaseActivityModule.ActivitySummary memory latestSummary =
            _buildActivitySummary(100, block.timestamp - 100 days, block.timestamp, 10, block.timestamp, false);
        latestSummary.evidenceHash = keccak256("fresh-legacy-activity");
        _submitSummary(latestSummary);

        (int256 score, uint256 confidence, bytes32 evidence) = baseModule.evaluate(wallet);

        assertEq(evidence, latestSummary.evidenceHash);
        assertGt(score, 0);
        assertEq(confidence, 100);
        assertTrue(evidence != acceptedSummary.evidenceHash);
    }
}
