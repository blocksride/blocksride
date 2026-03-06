// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";

contract RIDETest is Test {
    RIDE internal ride;

    address internal owner = makeAddr("owner");
    address internal distributor = makeAddr("distributor");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        ride = new RIDE(owner, distributor);
    }

    function test_Constructor_MintsMaxSupplyToDistributor() public view {
        assertEq(ride.totalSupply(), ride.MAX_SUPPLY());
        assertEq(ride.balanceOf(distributor), ride.MAX_SUPPLY());
    }

    function test_Transfer_RevertWhen_NeitherSideWhitelisted() public {
        vm.prank(distributor);
        ride.transfer(alice, 100e18);

        vm.prank(alice);
        vm.expectRevert(RIDE.TransfersRestricted.selector);
        ride.transfer(bob, 1e18);
    }

    function test_Transfer_SuccessWhen_RecipientWhitelisted() public {
        vm.prank(owner);
        ride.setTransferWhitelist(alice, true);

        vm.prank(distributor);
        ride.transfer(alice, 100e18);

        vm.prank(alice);
        ride.transfer(bob, 10e18);

        assertEq(ride.balanceOf(bob), 10e18);
    }

    function test_Transfer_SuccessWhen_RestrictionsDisabled() public {
        vm.prank(distributor);
        ride.transfer(alice, 100e18);

        vm.prank(owner);
        ride.setTransfersRestricted(false);

        vm.prank(alice);
        ride.transfer(bob, 10e18);

        assertEq(ride.balanceOf(bob), 10e18);
    }

    function test_SetTransferWhitelist_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        ride.setTransferWhitelist(bob, true);
    }
}
