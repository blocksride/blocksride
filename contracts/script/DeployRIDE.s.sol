// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {RIDE} from "../src/RIDE.sol";

/// @title DeployRIDE
/// @notice Deploys the RIDE token contract for Phase 2.
contract DeployRIDE is Script {
    function run() external returns (RIDE ride) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("RIDE_OWNER", deployer);
        address distributor = vm.envOr("RIDE_DISTRIBUTOR", deployer);

        console.log("Deployer:", deployer);
        console.log("RIDE owner:", owner);
        console.log("Initial distributor:", distributor);

        vm.startBroadcast(deployerPrivateKey);
        ride = new RIDE(owner, distributor);
        vm.stopBroadcast();

        console.log("RIDE deployed at:", address(ride));
        console.log("RIDE total supply:", ride.totalSupply());
    }
}
