// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideStaking} from "../src/RideStaking.sol";

contract RideStakingTest is Test {
    RIDE internal ride;
    RideStaking internal staking;

    address internal owner = makeAddr("owner");
    address internal distributor = makeAddr("distributor");
    address internal alice = makeAddr("alice");

    function setUp() public {
        ride = new RIDE(owner, distributor);
        staking = new RideStaking(address(ride), owner);

        vm.prank(owner);
        ride.setTransferWhitelist(address(staking), true);

        vm.prank(distributor);
        ride.transfer(alice, 20_000e18);

        vm.prank(alice);
        ride.approve(address(staking), type(uint256).max);
    }

    function test_Stake_Success() public {
        vm.prank(alice);
        staking.stake(1_000e18);

        assertEq(staking.stakedBalance(alice), 1_000e18);
        assertEq(staking.totalStaked(), 1_000e18);
    }

    function test_GetUserFeeBps_Tiers() public {
        assertEq(staking.getUserFeeBps(alice), 200);

        vm.prank(alice);
        staking.stake(1_000e18);
        assertEq(staking.getUserFeeBps(alice), 150);

        vm.prank(alice);
        staking.stake(4_000e18);
        assertEq(staking.getUserFeeBps(alice), 100);

        vm.prank(alice);
        staking.stake(5_000e18);
        assertEq(staking.getUserFeeBps(alice), 50);
    }

    function test_UnstakeFlow_WithCooldown() public {
        vm.prank(alice);
        staking.stake(2_000e18);

        vm.prank(alice);
        staking.initiateUnstake(500e18);

        (uint256 amount, uint256 unlockTime) = staking.pendingUnstakes(alice);
        assertEq(amount, 500e18);
        assertGt(unlockTime, block.timestamp);
        assertEq(staking.stakedBalance(alice), 1_500e18);

        vm.prank(alice);
        vm.expectRevert(RideStaking.CooldownNotMet.selector);
        staking.completeUnstake();

        vm.warp(block.timestamp + 7 days + 1);

        uint256 balanceBefore = ride.balanceOf(alice);
        vm.prank(alice);
        staking.completeUnstake();
        assertEq(ride.balanceOf(alice), balanceBefore + 500e18);
    }
}
