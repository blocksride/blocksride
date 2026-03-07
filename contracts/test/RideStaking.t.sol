// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideDistributor} from "../src/RideDistributor.sol";
import {RideStaking} from "../src/RideStaking.sol";

contract RideStakingTest is Test {
    RIDE internal ride;
    RideDistributor internal distributorContract;
    RideStaking internal staking;

    address internal coldAdmin = makeAddr("coldAdmin");
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal alice = makeAddr("alice");

    function setUp() public {
        distributorContract = new RideDistributor(coldAdmin, admin, treasury, relayer);
        ride = new RIDE(coldAdmin, admin, treasury, relayer, address(distributorContract));
        staking = new RideStaking(address(ride), coldAdmin, admin, treasury, relayer);

        vm.prank(admin);
        ride.wireSystemContracts(address(distributorContract), address(staking));

        vm.prank(address(distributorContract));
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

    function test_RoleAssignments() public view {
        assertTrue(staking.hasRole(staking.DEFAULT_ADMIN_ROLE(), coldAdmin));
        assertTrue(staking.hasRole(staking.ADMIN_ROLE(), admin));
        assertTrue(staking.hasRole(staking.TREASURY_ROLE(), treasury));
        assertTrue(staking.hasRole(staking.RELAYER_ROLE(), relayer));
    }
}
