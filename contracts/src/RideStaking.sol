// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title RideStaking
/// @notice Stake RIDE to get fee discounts and support cooldown-based unstaking.
contract RideStaking is AccessControl, ReentrancyGuard {
    error AmountZero();
    error InsufficientStake();
    error UnstakeAlreadyPending();
    error NoPendingUnstake();
    error CooldownNotMet();
    error ZeroAddress();

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    uint256 public constant UNSTAKE_COOLDOWN = 7 days;

    struct PendingUnstake {
        uint256 amount;
        uint256 unlockTime;
    }

    IERC20 public immutable RIDE_TOKEN;
    uint256 public totalStaked;

    mapping(address => uint256) public stakedBalance;
    mapping(address => PendingUnstake) public pendingUnstakes;

    event Staked(address indexed user, uint256 amount);
    event UnstakeInitiated(address indexed user, uint256 amount, uint256 unlockTime);
    event UnstakeCompleted(address indexed user, uint256 amount);

    constructor(address _rideToken, address coldAdmin, address admin, address treasury, address relayer) {
        RIDE_TOKEN = IERC20(_rideToken);
        _grantRole(DEFAULT_ADMIN_ROLE, coldAdmin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(RELAYER_ROLE, relayer);
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountZero();
        require(RIDE_TOKEN.transferFrom(msg.sender, address(this), amount), "RIDE transfer failed");

        stakedBalance[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function initiateUnstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert AmountZero();
        if (stakedBalance[msg.sender] < amount) revert InsufficientStake();
        if (pendingUnstakes[msg.sender].amount != 0) revert UnstakeAlreadyPending();

        stakedBalance[msg.sender] -= amount;
        totalStaked -= amount;

        uint256 unlockTime = block.timestamp + UNSTAKE_COOLDOWN;
        pendingUnstakes[msg.sender] = PendingUnstake({amount: amount, unlockTime: unlockTime});
        emit UnstakeInitiated(msg.sender, amount, unlockTime);
    }

    function completeUnstake() external nonReentrant {
        PendingUnstake memory pending = pendingUnstakes[msg.sender];
        if (pending.amount == 0) revert NoPendingUnstake();
        if (block.timestamp < pending.unlockTime) revert CooldownNotMet();

        delete pendingUnstakes[msg.sender];
        require(RIDE_TOKEN.transfer(msg.sender, pending.amount), "RIDE transfer failed");
        emit UnstakeCompleted(msg.sender, pending.amount);
    }

    function getUserFeeBps(address user) public view returns (uint256) {
        uint256 staked = stakedBalance[user];
        if (staked >= 10_000e18) return 50; // 0.5%
        if (staked >= 5_000e18) return 100; // 1.0%
        if (staked >= 1_000e18) return 150; // 1.5%
        return 200; // default 2.0%
    }
}
