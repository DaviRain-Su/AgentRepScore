// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IScoreModule {
    /// @notice 模块名称，如 "UniswapScoreModule"
    function name() external view returns (string memory);

    /// @notice 模块类别，如 "dex", "lending", "activity"
    function category() external view returns (string memory);

    /// @notice 评估指定钱包地址
    /// @param wallet 被评估的 Agent 钱包地址
    /// @return score 分数，范围 [-10000, 10000]
    /// @return confidence 置信度，范围 [0, 100]，决定该模块权重实际生效比例
    /// @return evidence 链上可验证的证据哈希（通常为 keccak256 聚合值）
    function evaluate(address wallet) external view returns (int256 score, uint256 confidence, bytes32 evidence);

    /// @notice 返回该模块输出的指标名称列表
    function metricNames() external view returns (string[] memory);
}
