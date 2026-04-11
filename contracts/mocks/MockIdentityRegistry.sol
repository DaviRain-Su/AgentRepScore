// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockIdentityRegistry {
    mapping(uint256 => address) public wallets;

    function setAgentWallet(uint256 agentId, address wallet) external {
        wallets[agentId] = wallet;
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return wallets[agentId];
    }

    function ownerOf(uint256) external pure returns (address) {
        return address(0);
    }

    function register(string calldata) external pure returns (uint256) {
        return 0;
    }

    function setAgentWallet(uint256, address, uint256, bytes calldata) external pure {}
    function unsetAgentWallet(uint256) external pure {}
}
