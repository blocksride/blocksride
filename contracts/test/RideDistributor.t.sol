// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideDistributor} from "../src/RideDistributor.sol";
import {RideStaking} from "../src/RideStaking.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

contract RideDistributorTest is Test {
    RIDE internal ride;
    RideDistributor internal distributor;
    RideStaking internal staking;

    address internal coldAdmin = makeAddr("coldAdmin");
    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");
    address internal relayer = makeAddr("relayer");
    address internal alice = makeAddr("alice");

    function setUp() public {
        distributor = new RideDistributor(coldAdmin, admin, treasury, relayer);
        ride = new RIDE(coldAdmin, admin, treasury, relayer, address(distributor));
        staking = new RideStaking(address(ride), coldAdmin, admin, treasury, relayer);

        vm.startPrank(admin);
        distributor.setRideToken(address(ride));
        ride.wireSystemContracts(address(distributor), address(staking));
        vm.stopPrank();
    }

    function test_AllocateAndClaimBetRewards() public {
        uint256 periodId = _createActivePeriod(100_000e18);
        PoolId poolId = PoolId.wrap(bytes32(uint256(1)));

        vm.prank(treasury);
        distributor.allocateWindowReward(periodId, alice, poolId, 10, 250e18);
        vm.prank(treasury);
        distributor.allocateWindowReward(periodId, alice, poolId, 11, 150e18);

        uint256[] memory windows = new uint256[](2);
        windows[0] = 10;
        windows[1] = 11;

        vm.prank(alice);
        distributor.claimBetRewards(poolId, windows);

        assertEq(ride.balanceOf(alice), 400e18);
        assertEq(distributor.claimableWindowRewards(alice, PoolId.unwrap(poolId), 10), 0);
        assertEq(distributor.claimableWindowRewards(alice, PoolId.unwrap(poolId), 11), 0);
    }

    function test_ClaimAirdrop_Success() public {
        uint256 amount = 500e18;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(alice, amount))));

        vm.prank(treasury);
        distributor.setAirdropMerkleRoot(leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(alice);
        distributor.claimAirdrop(proof, amount);

        assertEq(ride.balanceOf(alice), amount);
        assertTrue(distributor.hasClaimedAirdrop(alice));
    }

    function test_ClaimAirdrop_RevertWhen_DoubleClaim() public {
        uint256 amount = 500e18;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(alice, amount))));

        vm.prank(treasury);
        distributor.setAirdropMerkleRoot(leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.startPrank(alice);
        distributor.claimAirdrop(proof, amount);

        vm.expectRevert(RideDistributor.AirdropAlreadyClaimed.selector);
        distributor.claimAirdrop(proof, amount);
        vm.stopPrank();
    }

    function test_AllocateWindowReward_RevertWhen_ExceedsCap() public {
        uint256 periodId = _createActivePeriod(100e18);
        PoolId poolId = PoolId.wrap(bytes32(uint256(1)));

        vm.prank(treasury);
        vm.expectRevert(RideDistributor.EmissionCapExceeded.selector);
        distributor.allocateWindowReward(periodId, alice, poolId, 10, 101e18);
    }

    function test_OnlyTreasuryCanAllocate() public {
        uint256 periodId = _createActivePeriod(100e18);
        PoolId poolId = PoolId.wrap(bytes32(uint256(1)));

        vm.prank(alice);
        vm.expectRevert();
        distributor.allocateWindowReward(periodId, alice, poolId, 10, 10e18);
    }

    function test_SetRideToken_OnlyOnce() public {
        vm.prank(admin);
        vm.expectRevert(RideDistributor.RideTokenAlreadySet.selector);
        distributor.setRideToken(address(ride));
    }

    function test_SetRideToken_OnlyAdmin() public {
        RideDistributor uninitialized = new RideDistributor(coldAdmin, admin, treasury, relayer);

        vm.prank(treasury);
        vm.expectRevert();
        uninitialized.setRideToken(address(ride));
    }

    function test_RoleAssignments() public view {
        assertTrue(distributor.hasRole(distributor.DEFAULT_ADMIN_ROLE(), coldAdmin));
        assertTrue(distributor.hasRole(distributor.ADMIN_ROLE(), admin));
        assertTrue(distributor.hasRole(distributor.TREASURY_ROLE(), treasury));
        assertTrue(distributor.hasRole(distributor.RELAYER_ROLE(), relayer));
    }

    function test_RoleHandoff_TreasuryRotationWorks() public {
        address newTreasury = makeAddr("newTreasury");

        vm.startPrank(coldAdmin);
        distributor.grantRole(distributor.TREASURY_ROLE(), newTreasury);
        distributor.revokeRole(distributor.TREASURY_ROLE(), treasury);
        vm.stopPrank();

        vm.prank(treasury);
        vm.expectRevert();
        distributor.createEmissionPeriod(block.timestamp - 1, block.timestamp + 1 days, 100e18);

        vm.prank(newTreasury);
        distributor.createEmissionPeriod(block.timestamp - 1, block.timestamp + 1 days, 100e18);
    }

    function _createActivePeriod(uint256 allocation) internal returns (uint256 periodId) {
        vm.prank(treasury);
        periodId = distributor.createEmissionPeriod(block.timestamp - 1, block.timestamp + 1 days, allocation);
    }
}
