// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RIDE} from "../src/RIDE.sol";
import {RideDistributor} from "../src/RideDistributor.sol";
import {RideStaking} from "../src/RideStaking.sol";

/// @title DeployRIDE
/// @notice Deploys and wires the full RIDE system for Phase 2.
contract DeployRIDE is Script {
    function run() external returns (RIDE ride, RideDistributor distributor, RideStaking staking) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address coldAdmin = vm.envAddress("RIDE_COLD_ADMIN");
        address admin = vm.envAddress("RIDE_ADMIN");
        address treasury = vm.envAddress("RIDE_TREASURY");
        address relayer = vm.envAddress("RIDE_RELAYER");

        console.log("Deployer:", deployer);
        console.log("Cold admin:", coldAdmin);
        console.log("Admin:", admin);
        console.log("Treasury:", treasury);
        console.log("Relayer:", relayer);

        vm.startBroadcast(deployerPrivateKey);

        distributor = new RideDistributor(coldAdmin, admin, treasury, relayer);
        ride = new RIDE(coldAdmin, admin, treasury, relayer, address(distributor));
        staking = new RideStaking(address(ride), coldAdmin, admin, treasury, relayer);

        distributor.setRideToken(address(ride));
        ride.wireSystemContracts(address(distributor), address(staking));

        vm.stopBroadcast();

        console.log("RIDE deployed at:", address(ride));
        console.log("RideDistributor deployed at:", address(distributor));
        console.log("RideStaking deployed at:", address(staking));
        console.log("RIDE total supply:", ride.totalSupply());
        console.log("RIDE distributor balance:", ride.balanceOf(address(distributor)));
    }
}
