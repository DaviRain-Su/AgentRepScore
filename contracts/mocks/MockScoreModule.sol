// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IScoreModule.sol";

contract MockScoreModule is IScoreModule {
    string private _name;
    string private _category;
    int256 private _score;
    uint256 private _confidence;
    bytes32 private _evidence;

    constructor(string memory name_, string memory category_, int256 score_, uint256 confidence_, bytes32 evidence_) {
        _name = name_;
        _category = category_;
        _score = score_;
        _confidence = confidence_;
        _evidence = evidence_;
    }

    function setResult(int256 score_, uint256 confidence_, bytes32 evidence_) external {
        _score = score_;
        _confidence = confidence_;
        _evidence = evidence_;
    }

    function name() external view override returns (string memory) {
        return _name;
    }

    function category() external view override returns (string memory) {
        return _category;
    }

    function evaluate(address) external view override returns (int256 score, uint256 confidence, bytes32 evidence) {
        return (_score, _confidence, _evidence);
    }

    function metricNames() external pure override returns (string[] memory) {
        return new string[](0);
    }
}
