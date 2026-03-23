// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PariHook} from "../src/PariHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";

/**
 * @title DeployPariHook
 * @notice Deterministic Uniswap v4 hook deployment for Base mainnet and Base Sepolia.
 * @dev The hook address must have the correct low 14-bit permission mask. This script mines a
 *      CREATE2 salt against Foundry's deterministic CREATE2 deployer and then broadcasts the deployment.
 *
 * Required env:
 * - PRIVATE_KEY
 * - ADMIN_ADDRESS
 * - TREASURY_ADDRESS
 * - RELAYER_ADDRESS
 *
 * Optional env overrides:
 * - POOL_MANAGER_ADDRESS
 * - PYTH_ORACLE_ADDRESS
 * - USDC_ADDRESS
 *
 * Example dry-run:
 * forge script script/DeployPariHook.s.sol:DeployPariHook \
 *   --rpc-url $BASE_MAINNET_RPC_URL \
 *   --chain-id 8453
 *
 * Example broadcast:
 * forge script script/DeployPariHook.s.sol:DeployPariHook \
 *   --rpc-url $BASE_MAINNET_RPC_URL \
 *   --chain-id 8453 \
 *   --broadcast \
 *   --verify
 */
contract DeployPariHook is Script {
    uint256 internal constant BASE_MAINNET_CHAIN_ID = 8453;
    uint256 internal constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint160 internal constant HOOK_MASK = uint160((1 << 14) - 1);

    address internal constant BASE_MAINNET_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant BASE_MAINNET_PYTH = 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a;
    address internal constant BASE_MAINNET_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    address internal constant BASE_SEPOLIA_POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant BASE_SEPOLIA_PYTH = 0xA2aa501b19aff244D90cc15a4Cf739D2725B5729;
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external returns (PariHook pariHook, bytes32 salt, address predicted) {
        uint256 chainId = block.chainid;
        require(chainId == BASE_MAINNET_CHAIN_ID || chainId == BASE_SEPOLIA_CHAIN_ID, "Unsupported chain");

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address admin = vm.envAddress("ADMIN_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address relayer = vm.envAddress("RELAYER_ADDRESS");

        (address poolManager, address pythOracle, address usdcToken, string memory networkLabel) =
            _resolveNetworkConfig(chainId);

        bytes memory constructorArgs =
            abi.encode(IPoolManager(poolManager), IPyth(pythOracle), admin, treasury, relayer);
        bytes32 initCodeHash = keccak256(abi.encodePacked(type(PariHook).creationCode, constructorArgs));
        uint160 requiredFlags = Hooks.BEFORE_INITIALIZE_FLAG;

        salt = _mineHookSalt(initCodeHash, requiredFlags);
        predicted = vm.computeCreate2Address(salt, initCodeHash, CREATE2_FACTORY);

        require((uint160(predicted) & HOOK_MASK) == requiredFlags, "Invalid mined hook address");

        console.log("\n============================================");
        console.log("  PARIHOOK CREATE2 DEPLOYMENT");
        console.log("============================================\n");
        console.log("Network:", networkLabel);
        console.log("Chain ID:", chainId);
        console.log("Deployer EOA:", deployer);
        console.log("CREATE2 Factory:", CREATE2_FACTORY);
        console.log("PoolManager:", poolManager);
        console.log("Pyth Oracle:", pythOracle);
        console.log("USDC:", usdcToken);
        console.log("Admin:", admin);
        console.log("Treasury:", treasury);
        console.log("Relayer:", relayer);
        console.log("Required Hook Flags:", requiredFlags);
        console.log("Salt:");
        console.logBytes32(salt);
        console.log("Predicted Hook Address:", predicted);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);
        pariHook = new PariHook{salt: salt}(IPoolManager(poolManager), IPyth(pythOracle), admin, treasury, relayer);
        vm.stopBroadcast();

        require(address(pariHook) == predicted, "CREATE2 deployment address mismatch");
        require((uint160(address(pariHook)) & HOOK_MASK) == requiredFlags, "Deployed hook flags mismatch");

        console.log("PariHook deployed at:", address(pariHook));
        console.log("DOMAIN_SEPARATOR:", vm.toString(pariHook.DOMAIN_SEPARATOR()));
        console.log("Has ADMIN_ROLE:", pariHook.hasRole(pariHook.ADMIN_ROLE(), admin));
        console.log("Has TREASURY_ROLE:", pariHook.hasRole(pariHook.TREASURY_ROLE(), treasury));
        console.log("Has RELAYER_ROLE:", pariHook.hasRole(pariHook.RELAYER_ROLE(), relayer));
        console.log("\nNext steps:");
        console.log("1. Configure grid via configureGrid()");
        console.log("2. Initialize the pool via PoolManager.initialize()");
        console.log("3. Point backend/frontend env to the new hook address");
    }

    function _resolveNetworkConfig(uint256 chainId)
        internal
        view
        returns (address poolManager, address pythOracle, address usdcToken, string memory networkLabel)
    {
        if (chainId == BASE_MAINNET_CHAIN_ID) {
            poolManager = vm.envOr("POOL_MANAGER_ADDRESS", BASE_MAINNET_POOL_MANAGER);
            pythOracle = vm.envOr("PYTH_ORACLE_ADDRESS", BASE_MAINNET_PYTH);
            usdcToken = vm.envOr("USDC_ADDRESS", BASE_MAINNET_USDC);
            networkLabel = "Base Mainnet";
            return (poolManager, pythOracle, usdcToken, networkLabel);
        }

        poolManager = vm.envOr("POOL_MANAGER_ADDRESS", BASE_SEPOLIA_POOL_MANAGER);
        pythOracle = vm.envOr("PYTH_ORACLE_ADDRESS", BASE_SEPOLIA_PYTH);
        usdcToken = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        networkLabel = "Base Sepolia";
    }

    function _mineHookSalt(bytes32 initCodeHash, uint160 requiredFlags) internal view returns (bytes32 minedSalt) {
        for (uint256 i = 0; i < 500000; ++i) {
            bytes32 candidateSalt = bytes32(i);
            address predicted = vm.computeCreate2Address(candidateSalt, initCodeHash, CREATE2_FACTORY);
            if ((uint160(predicted) & HOOK_MASK) == requiredFlags) {
                return candidateSalt;
            }
        }
        revert("Unable to mine CREATE2 salt for required hook flags");
    }
}
