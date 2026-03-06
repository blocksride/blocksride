// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

/// @title RideDistributor
/// @notice Controls emissions, reward allocations, and merkle airdrop claims.
contract RideDistributor is Ownable, ReentrancyGuard {
    error InvalidPeriodBounds();
    error InvalidPeriod();
    error EmissionCapExceeded();
    error NoRewards();
    error AirdropAlreadyClaimed();
    error InvalidMerkleProof();
    error ZeroAmount();

    struct EmissionPeriod {
        uint256 startTime;
        uint256 endTime;
        uint256 totalAllocation;
        uint256 emitted;
    }

    IERC20 public immutable rideToken;
    uint256 public periodCount;
    bytes32 public airdropMerkleRoot;

    mapping(uint256 => EmissionPeriod) public periods;
    mapping(address => bool) public hasClaimedAirdrop;
    mapping(address => mapping(bytes32 => mapping(uint256 => uint256))) public claimableWindowRewards;

    event EmissionPeriodCreated(uint256 indexed periodId, uint256 startTime, uint256 endTime, uint256 totalAllocation);
    event WindowRewardAllocated(
        uint256 indexed periodId, address indexed user, bytes32 indexed poolId, uint256 windowId, uint256 amount
    );
    event BetRewardsClaimed(address indexed user, bytes32 indexed poolId, uint256[] windowIds, uint256 totalClaimed);
    event AirdropRootUpdated(bytes32 indexed merkleRoot);
    event AirdropClaimed(address indexed user, uint256 amount);

    constructor(address _rideToken, address initialOwner) Ownable(initialOwner) {
        rideToken = IERC20(_rideToken);
    }

    function createEmissionPeriod(uint256 startTime, uint256 endTime, uint256 totalAllocation)
        external
        onlyOwner
        returns (uint256 periodId)
    {
        if (startTime >= endTime) revert InvalidPeriodBounds();
        periodId = periodCount++;
        periods[periodId] =
            EmissionPeriod({startTime: startTime, endTime: endTime, totalAllocation: totalAllocation, emitted: 0});
        emit EmissionPeriodCreated(periodId, startTime, endTime, totalAllocation);
    }

    function setAirdropMerkleRoot(bytes32 merkleRoot) external onlyOwner {
        airdropMerkleRoot = merkleRoot;
        emit AirdropRootUpdated(merkleRoot);
    }

    function allocateWindowReward(uint256 periodId, address user, PoolId poolId, uint256 windowId, uint256 amount)
        external
        onlyOwner
    {
        if (amount == 0) revert ZeroAmount();
        EmissionPeriod storage period = periods[periodId];
        if (period.startTime == 0 && period.endTime == 0) revert InvalidPeriod();
        if (block.timestamp < period.startTime || block.timestamp > period.endTime) revert InvalidPeriod();

        uint256 nextEmitted = period.emitted + amount;
        if (nextEmitted > period.totalAllocation) revert EmissionCapExceeded();

        period.emitted = nextEmitted;
        bytes32 rawPoolId = PoolId.unwrap(poolId);
        claimableWindowRewards[user][rawPoolId][windowId] += amount;
        emit WindowRewardAllocated(periodId, user, rawPoolId, windowId, amount);
    }

    function claimBetRewards(PoolId poolId, uint256[] calldata windowIds) external nonReentrant {
        bytes32 rawPoolId = PoolId.unwrap(poolId);
        uint256 totalClaimed;

        for (uint256 i = 0; i < windowIds.length; i++) {
            uint256 amount = claimableWindowRewards[msg.sender][rawPoolId][windowIds[i]];
            if (amount != 0) {
                totalClaimed += amount;
                claimableWindowRewards[msg.sender][rawPoolId][windowIds[i]] = 0;
            }
        }

        if (totalClaimed == 0) revert NoRewards();
        require(rideToken.transfer(msg.sender, totalClaimed), "RIDE transfer failed");
        emit BetRewardsClaimed(msg.sender, rawPoolId, windowIds, totalClaimed);
    }

    function claimAirdrop(bytes32[] calldata merkleProof, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (hasClaimedAirdrop[msg.sender]) revert AirdropAlreadyClaimed();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, amount))));
        bool valid = MerkleProof.verify(merkleProof, airdropMerkleRoot, leaf);
        if (!valid) revert InvalidMerkleProof();

        hasClaimedAirdrop[msg.sender] = true;
        require(rideToken.transfer(msg.sender, amount), "RIDE transfer failed");
        emit AirdropClaimed(msg.sender, amount);
    }
}
