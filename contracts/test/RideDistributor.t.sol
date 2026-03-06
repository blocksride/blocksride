// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideDistributor} from "../src/RideDistributor.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

contract RideDistributorTest is Test {
    RIDE internal ride;
    RideDistributor internal distributor;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");

    function setUp() public {
        ride = new RIDE(owner, address(this));
        distributor = new RideDistributor(address(ride), owner);

        vm.prank(owner);
        ride.setTransferWhitelist(address(distributor), true);

        // Fund distributor for rewards/airdrops from the initial minted supply.
        ride.transfer(address(distributor), 1_000_000e18);
    }

    function test_AllocateAndClaimBetRewards() public {
        uint256 periodId = _createActivePeriod(100_000e18);
        PoolId poolId = PoolId.wrap(bytes32(uint256(1)));

        vm.prank(owner);
        distributor.allocateWindowReward(periodId, alice, poolId, 10, 250e18);
        vm.prank(owner);
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

        vm.prank(owner);
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

        vm.prank(owner);
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

        vm.prank(owner);
        vm.expectRevert(RideDistributor.EmissionCapExceeded.selector);
        distributor.allocateWindowReward(periodId, alice, poolId, 10, 101e18);
    }

    function _createActivePeriod(uint256 allocation) internal returns (uint256 periodId) {
        vm.prank(owner);
        periodId = distributor.createEmissionPeriod(block.timestamp - 1, block.timestamp + 1 days, allocation);
    }
}
