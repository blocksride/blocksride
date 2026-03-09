// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideDistributor} from "../src/RideDistributor.sol";
import {RideStaking} from "../src/RideStaking.sol";

contract RIDETest is Test {
    RIDE internal ride;
    RideDistributor internal distributorContract;
    RideStaking internal staking;

    address internal coldAdmin = makeAddr("coldAdmin");
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        distributorContract = new RideDistributor(coldAdmin, admin, treasury, relayer);
        ride = new RIDE(coldAdmin, admin, treasury, relayer, address(distributorContract));
        staking = new RideStaking(address(ride), coldAdmin, admin, treasury, relayer);

        vm.prank(admin);
        ride.wireSystemContracts(address(distributorContract), address(staking));
    }

    function test_Constructor_MintsMaxSupplyToDistributor() public view {
        assertEq(ride.totalSupply(), ride.MAX_SUPPLY());
        assertEq(ride.balanceOf(address(distributorContract)), ride.MAX_SUPPLY());
    }

    function test_Transfer_RevertWhen_NeitherSideWhitelisted() public {
        vm.prank(address(distributorContract));
        assertTrue(ride.transfer(alice, 100e18));

        vm.prank(alice);
        vm.expectRevert(RIDE.TransfersRestricted.selector);
        // forge-lint: disable-next-line(erc20-unchecked-transfer) — expected to revert, no return value possible
        ride.transfer(bob, 1e18);
    }

    function test_Transfer_SuccessWhen_RecipientWhitelisted() public {
        // Give alice some RIDE (distributor is whitelisted sender)
        vm.prank(address(distributorContract));
        assertTrue(ride.transfer(alice, 100e18));

        // alice (non-whitelisted EOA) can transfer to staking (whitelisted contract recipient)
        vm.prank(alice);
        assertTrue(ride.transfer(address(staking), 10e18));

        assertEq(ride.balanceOf(address(staking)), 10e18);
    }

    function test_Transfer_SuccessWhen_SenderWhitelisted() public {
        // distributor is whitelisted (receives minted supply), so it can transfer freely
        vm.prank(address(distributorContract));
        assertTrue(ride.transfer(alice, 100e18));

        assertEq(ride.balanceOf(alice), 100e18);
    }

    function test_SetTransferWhitelist_OnlyAdminRole() public {
        vm.prank(alice);
        vm.expectRevert();
        ride.setTransferWhitelist(address(staking), true);
    }

    function test_SetTransferWhitelist_RevertWhen_EOA() public {
        vm.prank(admin);
        vm.expectRevert(RIDE.NotContract.selector);
        ride.setTransferWhitelist(alice, true);
    }

    function test_RoleAssignments() public view {
        assertTrue(ride.hasRole(ride.DEFAULT_ADMIN_ROLE(), coldAdmin));
        assertTrue(ride.hasRole(ride.ADMIN_ROLE(), admin));
        assertTrue(ride.hasRole(ride.TREASURY_ROLE(), treasury));
        assertTrue(ride.hasRole(ride.RELAYER_ROLE(), relayer));
    }

    function test_WireSystemContracts_OnlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        ride.wireSystemContracts(address(distributorContract), address(staking));
    }

    function test_NoFurtherMintingPath() public {
        (bool ok,) = address(ride).call(abi.encodeWithSignature("mint(address,uint256)", alice, 1e18));
        assertFalse(ok);
        assertEq(ride.totalSupply(), ride.MAX_SUPPLY());
    }

    function test_RoleHandoff_AdminRotationWorks() public {
        address newAdmin = makeAddr("newAdmin");

        vm.startPrank(coldAdmin);
        ride.grantRole(ride.ADMIN_ROLE(), newAdmin);
        ride.revokeRole(ride.ADMIN_ROLE(), admin);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectRevert();
        ride.setTransferWhitelist(address(staking), true);

        vm.prank(newAdmin);
        ride.setTransferWhitelist(address(staking), true);
    }
}
