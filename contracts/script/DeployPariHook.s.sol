// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

/**
 * @title DeployPariHook
 * @notice Deployment script for PariHook contract on Base Sepolia
 *
 * Usage:
 * ------
 * 1. Ensure .env file is configured with:
 *    - PRIVATE_KEY (deployer wallet)
 *    - BASE_SEPOLIA_RPC_URL
 * 2. Run deployment:
 *    source .env
 *    forge script script/DeployPariHook.s.sol:DeployPariHook \
 *      --rpc-url $BASE_SEPOLIA_RPC_URL \
 *      --broadcast \
 *      --verify \
 *      -vvvv
 *
 * Contract Addresses (Base Sepolia):
 * - PoolManager: 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
 * - Pyth Oracle: 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729
 * - USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
 */
contract DeployPariHook is Script {
    // Base Sepolia Contract Addresses
    address constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant PYTH_ORACLE = 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729;
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Role Addresses
    address constant RELAYER = 0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06;

    function run() public {
        // Load deployer private key from environment
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("\n============================================");
        console.log("  PARIHOOK DEPLOYMENT - BASE SEPOLIA");
        console.log("============================================\n");

        console.log("Deployer Address:", deployer);
        console.log("Deployer Balance:", deployer.balance / 1e18, "ETH");
        console.log("");

        console.log("Configuration:");
        console.log("  PoolManager:", POOL_MANAGER);
        console.log("  Pyth Oracle:", PYTH_ORACLE);
        console.log("  USDC Token:", USDC);
        console.log("");

        console.log("Role Assignment:");
        console.log("  DEFAULT_ADMIN_ROLE:", deployer);
        console.log("  ADMIN_ROLE:", deployer);
        console.log("  TREASURY_ROLE:", deployer);
        console.log("  RELAYER_ROLE:", RELAYER);
        console.log("");

        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying PariHook...");
        PariHook pariHook = new PariHook(
            IPoolManager(POOL_MANAGER),
            IPyth(PYTH_ORACLE),
            deployer, // ADMIN_ROLE
            deployer, // TREASURY_ROLE
            RELAYER // RELAYER_ROLE
        );

        console.log("PariHook deployed at:", address(pariHook));
        console.log("");

        // Verify role assignments
        console.log("Verifying role assignments...");
        console.log("  Has DEFAULT_ADMIN_ROLE:", pariHook.hasRole(pariHook.DEFAULT_ADMIN_ROLE(), deployer));
        console.log("  Has ADMIN_ROLE:", pariHook.hasRole(pariHook.ADMIN_ROLE(), deployer));
        console.log("  Has TREASURY_ROLE:", pariHook.hasRole(pariHook.TREASURY_ROLE(), deployer));
        console.log("  RELAYER has RELAYER_ROLE:", pariHook.hasRole(pariHook.RELAYER_ROLE(), RELAYER));
        console.log("");

        // Display contract state
        console.log("Contract State:");
        console.log("  PoolManager:", address(pariHook.POOL_MANAGER()));
        console.log("  Pyth Oracle:", address(pariHook.PYTH_ORACLE()));
        console.log("  DOMAIN_SEPARATOR:", vm.toString(pariHook.DOMAIN_SEPARATOR()));
        console.log("  Paused:", pariHook.paused());
        console.log("");

        vm.stopBroadcast();

        console.log("============================================");
        console.log("  DEPLOYMENT COMPLETE");
        console.log("============================================\n");

        console.log("Next Steps:");
        console.log("1. Save the PariHook address:", address(pariHook));
        console.log("2. Configure a grid using configureGrid()");
        console.log("3. Initialize pool in PoolManager");
        console.log("4. Start accepting bets");
        console.log("");

        console.log("Example Grid Configuration (ETH/USD):");
        console.log("  pythPriceFeedId: 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace");
        console.log("  bandWidth: 2000000 ($2.00)");
        console.log("  windowDuration: 60 (seconds)");
        console.log("  frozenWindows: 3");
        console.log("  maxStakePerCell: 100000000000 ($100,000)");
        console.log("  feeBps: 200 (2%)");
        console.log("  minPoolThreshold: 1000000 ($1.00)");
        console.log("  gridEpoch: [future timestamp - aligned to clean boundary]");
        console.log("  usdcToken:", USDC);
        console.log("");
    }
}
