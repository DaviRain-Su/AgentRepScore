// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockReputationRegistry {
    struct FeedbackCall {
        uint256 agentId;
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        string endpoint;
        string feedbackURI;
        bytes32 feedbackHash;
    }

    FeedbackCall[] public calls;

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata endpoint,
        string calldata feedbackURI,
        bytes32 feedbackHash
    ) external {
        calls.push(FeedbackCall(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash));
    }

    function getSummary(uint256, address[] calldata, string calldata, string calldata)
        external
        pure
        returns (uint64, int128, uint8)
    {
        return (0, 0, 0);
    }

    function lastCall() external view returns (FeedbackCall memory) {
        require(calls.length > 0, "No calls");
        return calls[calls.length - 1];
    }
}
