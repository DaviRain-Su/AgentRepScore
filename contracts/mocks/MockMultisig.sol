// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockMultisig {
    address[] public owners;
    uint256 public constant THRESHOLD = 2;

    mapping(address => bool) public isOwner;
    mapping(bytes32 => uint256) public approvals;
    mapping(bytes32 => mapping(address => bool)) public hasApproved;

    error NotOwner(address caller);
    error AlreadyApproved(bytes32 txHash, address caller);
    error InsufficientApprovals(bytes32 txHash, uint256 current, uint256 required);
    error ExecutionFailed(bytes32 txHash);

    event Approved(bytes32 indexed txHash, address indexed owner);
    event Executed(bytes32 indexed txHash, address target);

    constructor(address[] memory _owners) {
        require(_owners.length >= THRESHOLD, "not enough owners");
        owners = _owners;
        for (uint256 i = 0; i < _owners.length; i++) {
            isOwner[_owners[i]] = true;
        }
    }

    function approve(address target, bytes calldata data) external {
        if (!isOwner[msg.sender]) revert NotOwner(msg.sender);
        bytes32 txHash = keccak256(abi.encode(target, data));
        if (hasApproved[txHash][msg.sender]) revert AlreadyApproved(txHash, msg.sender);
        hasApproved[txHash][msg.sender] = true;
        approvals[txHash]++;
        emit Approved(txHash, msg.sender);
    }

    function execute(address target, bytes calldata data) external {
        bytes32 txHash = keccak256(abi.encode(target, data));
        uint256 current = approvals[txHash];
        if (current < THRESHOLD) revert InsufficientApprovals(txHash, current, THRESHOLD);
        (bool success,) = target.call(data);
        if (!success) revert ExecutionFailed(txHash);
        emit Executed(txHash, target);
    }
}
