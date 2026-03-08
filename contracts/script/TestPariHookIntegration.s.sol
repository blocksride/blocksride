// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title TestPariHookIntegration
 * @notice Test script to verify PariHook deployment and hook integration
 *
 * Usage:
 * ------
 * forge script script/TestPariHookIntegration.s.sol:TestPariHookIntegration \
 *   --rpc-url $BASE_SEPOLIA_RPC_URL \
 *   --broadcast \
 *   -vvvv
 *
 * This script will:
 * 1. Verify contract deployment and state
 * 2. Configure a test grid for ETH/USD
 * 3. Test hook permissions
 * 4. Test view functions
 * 5. Display next steps for pool initialization
 */
contract TestPariHookIntegration is Script {
    using PoolIdLibrary for PoolKey;

    // Deployed contract addresses
    PariHook public constant PARI_HOOK = PariHook(0xE6dB8dF1ECa3E26bD8D6f21b64a19db5505D9Db6);
    IPoolManager public constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    IPyth public constant PYTH_ORACLE = IPyth(0xA2aa501b19aff244D90cc15a4Cf739D2725B5729);
    address public constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Pyth price feed IDs
    bytes32 public constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public constant BTC_USD_FEED_ID = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

    function run() public {
        uint256 adminPrivateKey = vm.envUint("ADMIN_PRIVATE_KEY");
        address admin = vm.addr(adminPrivateKey);

        console.log("\n============================================");
        console.log("  PARIHOOK INTEGRATION TEST");
        console.log("  Base Sepolia Testnet");
        console.log("============================================\n");

        console.log("Test Executor:", admin);
        console.log("PariHook Address:", address(PARI_HOOK));
        console.log("PoolManager Address:", address(POOL_MANAGER));
        console.log("");

        // Test 1: Verify deployment state
        console.log("--------------------------------------------");
        console.log("TEST 1: Verify Deployment State");
        console.log("--------------------------------------------\n");
        testDeploymentState();

        // Test 2: Verify role assignments
        console.log("\n--------------------------------------------");
        console.log("TEST 2: Verify Role Assignments");
        console.log("--------------------------------------------\n");
        testRoleAssignments(admin);

        // Test 3: Configure grid
        console.log("\n--------------------------------------------");
        console.log("TEST 3: Configure Grid for ETH/USD");
        console.log("--------------------------------------------\n");
        testConfigureGrid(adminPrivateKey);

        // Test 4: Test view functions
        console.log("\n--------------------------------------------");
        console.log("TEST 4: Test View Functions");
        console.log("--------------------------------------------\n");
        testViewFunctions();

        // Test 5: Pyth Oracle Integration
        console.log("\n--------------------------------------------");
        console.log("TEST 5: Pyth Oracle Integration");
        console.log("--------------------------------------------\n");
        testPythOracle();

        // Test 6: Hook permissions check
        console.log("\n--------------------------------------------");
        console.log("TEST 6: Hook Permissions");
        console.log("--------------------------------------------\n");
        testHookPermissions();

        console.log("\n============================================");
        console.log("  INTEGRATION TEST COMPLETE");
        console.log("============================================\n");

        displayNextSteps();
    }

    function testDeploymentState() internal view {
        console.log("Contract State:");
        console.log("  PoolManager:", address(PARI_HOOK.POOL_MANAGER()));
        console.log("  Pyth Oracle:", address(PARI_HOOK.PYTH_ORACLE()));
        console.log("  Paused:", PARI_HOOK.paused());
        console.log("  DOMAIN_SEPARATOR:", vm.toString(PARI_HOOK.DOMAIN_SEPARATOR()));

        require(address(PARI_HOOK.POOL_MANAGER()) == address(POOL_MANAGER), "PoolManager mismatch");
        require(!PARI_HOOK.paused(), "Contract should not be paused");

        console.log("\n  [OK] Deployment state verified");
    }

    function testRoleAssignments(address admin) internal view {
        bytes32 defaultAdminRole = PARI_HOOK.DEFAULT_ADMIN_ROLE();
        bytes32 adminRole = PARI_HOOK.ADMIN_ROLE();
        bytes32 treasuryRole = PARI_HOOK.TREASURY_ROLE();
        bytes32 relayerRole = PARI_HOOK.RELAYER_ROLE();

        console.log("Checking roles for:", admin);
        console.log("  DEFAULT_ADMIN_ROLE:", PARI_HOOK.hasRole(defaultAdminRole, admin));
        console.log("  ADMIN_ROLE:", PARI_HOOK.hasRole(adminRole, admin));
        console.log("  TREASURY_ROLE:", PARI_HOOK.hasRole(treasuryRole, admin));

        address relayer = 0xF41886af501e2a0958dBD31D9a28AcD6c2f5db06;
        console.log("\nChecking RELAYER_ROLE for:", relayer);
        console.log("  RELAYER_ROLE:", PARI_HOOK.hasRole(relayerRole, relayer));

        require(PARI_HOOK.hasRole(adminRole, admin), "Admin should have ADMIN_ROLE");

        console.log("\n  [OK] Role assignments verified");
    }

    function testConfigureGrid(uint256 adminPrivateKey) internal {
        // Use the same pool key expected by keeper/frontend.
        Currency currency0 = Currency.wrap(USDC);
        Currency currency1 = Currency.wrap(address(0));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(PARI_HOOK))
        });
        PoolId poolId = poolKey.toId();

        // Calculate gridEpoch: 5 minutes from now, aligned to minute boundary
        uint256 currentTime = block.timestamp;
        uint256 gridEpoch = ((currentTime / 60) + 5) * 60; // Next 5-minute aligned boundary

        console.log("Grid Configuration:");
        console.log("  pythPriceFeedId: ETH/USD");
        console.log("  bandWidth: 2000000 ($2.00)");
        console.log("  windowDuration: 60 seconds");
        console.log("  frozenWindows: 3");
        console.log("  maxStakePerCell: 100000000000 ($100,000)");
        console.log("  feeBps: 200 (2%)");
        console.log("  minPoolThreshold: 1000000 ($1.00)");
        console.log("  poolId:", vm.toString(PoolId.unwrap(poolId)));
        console.log("  gridEpoch:", gridEpoch);
        console.log("  usdcToken:", USDC);
        console.log("");

        vm.startBroadcast(adminPrivateKey);

        try PARI_HOOK.configureGrid(
            poolKey,
            ETH_USD_FEED_ID, // pythPriceFeedId
            2_000_000, // bandWidth: $2.00
            60, // windowDuration: 60 seconds
            3, // frozenWindows
            100_000_000_000, // maxStakePerCell: $100k
            200, // feeBps: 2%
            1_000_000, // minPoolThreshold: $1.00
            gridEpoch,
            USDC
        ) {
            console.log("  [OK] Grid configured successfully");
        } catch Error(string memory reason) {
            console.log("  [WARN]  Grid configuration failed:", reason);
        } catch {
            console.log("  [WARN]  Grid configuration failed (low-level error)");
        }

        vm.stopBroadcast();
    }

    function testViewFunctions() internal view {
        // Query the same configured pool key.
        Currency currency0 = Currency.wrap(USDC);
        Currency currency1 = Currency.wrap(address(0));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(PARI_HOOK))
        });

        console.log("Testing view functions...");

        // Test getCurrentWindow
        try PARI_HOOK.getCurrentWindow(poolKey) returns (uint256 currentWindow) {
            console.log("  Current Window ID:", currentWindow);
            console.log("  [OK] getCurrentWindow() works");
        } catch {
            console.log("  [WARN]  getCurrentWindow() failed - grid may not be configured yet");
        }

        // Test getBettableWindows
        try PARI_HOOK.getBettableWindows(poolKey) returns (uint256 start, uint256 end) {
            console.log("  Bettable Windows start:", start);
            console.log("  Bettable Windows end:", end);
            console.log("  [OK] getBettableWindows() works");
        } catch {
            console.log("  [WARN]  getBettableWindows() failed - grid may not be configured yet");
        }
    }

    function testPythOracle() internal view {
        console.log("Pyth Oracle Connection Test:");
        console.log("  Oracle Address:", address(PYTH_ORACLE));
        console.log("");

        // Test ETH/USD price feed
        console.log("Testing ETH/USD Price Feed:");
        console.log("  Feed ID:", vm.toString(ETH_USD_FEED_ID));

        try PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID) returns (PythStructs.Price memory price) {
            console.log("");
            console.log("  Raw Price Data:");
            console.log("    price:", int256(price.price));
            console.log("    expo:", int256(price.expo));
            console.log("    conf:", price.conf);
            console.log("    publishTime:", price.publishTime);
            console.log("");

            // Convert to human-readable format
            uint256 humanPrice = convertPythPrice(price.price, price.expo);
            console.log("  Human-Readable Price:");
            console.log("    $", humanPrice);
            console.log("");

            // Convert to USDC 6-decimal format (for contract use)
            uint256 usdcPrice = convertToUsdc6Decimal(price.price, price.expo);
            console.log("  USDC 6-Decimal Format:");
            console.log("    value:", usdcPrice);
            console.log("    dollars:", usdcPrice / 1e6);
            console.log("");

            // Calculate cell ID for $2 band width
            uint256 bandWidth = 2_000_000;
            uint256 cellId = usdcPrice / bandWidth;
            uint256 cellLow = cellId * bandWidth;
            uint256 cellHigh = cellLow + bandWidth;

            console.log("  Grid Cell Mapping ($2 bands):");
            console.log("    cellId:", cellId);
            console.log("    range low: $", cellLow / 1e6);
            console.log("    range high: $", cellHigh / 1e6);
            console.log("");

            console.log("  [OK] Pyth oracle is working correctly");
        } catch {
            console.log("  [ERROR] Failed to fetch price from Pyth oracle");
        }

        // Test update fee
        console.log("\nPyth Update Fee:");
        bytes[] memory emptyData = new bytes[](0);
        uint256 updateFee = PYTH_ORACLE.getUpdateFee(emptyData);
        console.log("  Fee (wei):", updateFee);
        console.log("  Fee (ETH):", updateFee / 1e18);
        console.log("");

        // Test BTC/USD as well
        console.log("Testing BTC/USD Price Feed:");
        try PYTH_ORACLE.getPriceUnsafe(BTC_USD_FEED_ID) returns (PythStructs.Price memory price) {
            uint256 humanPrice = convertPythPrice(price.price, price.expo);
            console.log("  Current BTC Price: $", humanPrice);
            console.log("  [OK] BTC/USD feed working");
        } catch {
            console.log("  [WARN]  BTC/USD feed unavailable");
        }
        console.log("");
    }

    function convertPythPrice(int64 price, int32 expo) internal pure returns (uint256) {
        uint256 absPrice = SafeCast.toUint256(int256(price));
        if (expo >= 0) {
            return absPrice * (10 ** SafeCast.toUint256(int256(expo)));
        } else {
            return absPrice / (10 ** SafeCast.toUint256(int256(-expo)));
        }
    }

    function convertToUsdc6Decimal(int64 pythPrice, int32 pythExpo) internal pure returns (uint256) {
        uint256 absPrice = SafeCast.toUint256(int256(pythPrice));
        int32 exponentAdjustment = pythExpo + 6;
        if (exponentAdjustment >= 0) {
            return absPrice * (10 ** SafeCast.toUint256(int256(exponentAdjustment)));
        } else {
            return absPrice / (10 ** SafeCast.toUint256(int256(-exponentAdjustment)));
        }
    }

    function testHookPermissions() internal pure {
        console.log("Hook Permissions:");
        console.log("  Hook Address:", address(PARI_HOOK));
        console.log("");
        console.log("Expected Hook Flags:");
        console.log("  beforeInitialize: true [OK]");
        console.log("  afterInitialize: false");
        console.log("  beforeAddLiquidity: false");
        console.log("  afterAddLiquidity: false");
        console.log("  beforeRemoveLiquidity: false");
        console.log("  afterRemoveLiquidity: false");
        console.log("  beforeSwap: false");
        console.log("  afterSwap: false");
        console.log("  beforeDonate: false");
        console.log("  afterDonate: false");
        console.log("");
        console.log("Note: Hook address validation is currently disabled");
        console.log("      in PariHook.sol constructor (lines 236-256).");
        console.log("      For production, you must mine a hook address with");
        console.log("      the correct bit pattern using CREATE2.");
    }

    function displayNextSteps() internal pure {
        console.log("Next Steps:");
        console.log("");
        console.log("1. Initialize Pool in PoolManager");
        console.log("   - Call poolManager.initialize(poolKey, sqrtPriceX96)");
        console.log("   - This will trigger beforeInitialize hook");
        console.log("   - Hook will emit GridInitialized event");
        console.log("");
        console.log("2. Get Test USDC");
        console.log("   - Use Base Sepolia faucet or bridge");
        console.log("   - USDC Address: 0x036CbD53842c5426634e7929541eC2318f3dCF7e");
        console.log("");
        console.log("3. Test Bet Placement");
        console.log("   - Approve USDC to PariHook");
        console.log("   - Call placeBet(poolKey, cellId, windowId, amount)");
        console.log("   - Check bettable windows with getBettableWindows()");
        console.log("");
        console.log("4. Setup Keeper Service");
        console.log("   - Monitor windows for settlement");
        console.log("   - Call settle() with Pyth VAA after window ends");
        console.log("");
        console.log("5. Backend Integration");
        console.log("   - Update backend with PARIHOOK_ADDRESS");
        console.log("   - Configure relayer with RELAYER_PRIVATE_KEY");
        console.log("   - Implement gasless bet flow with placeBetWithSig()");
        console.log("");
    }
}
