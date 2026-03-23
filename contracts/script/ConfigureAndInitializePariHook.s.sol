// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";

import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Configures the grid and initializes the Uniswap v4 pool for an existing PariHook deployment.
/// @dev Uses the required sorted currency order for PoolManager: native ETH (currency0) then USDC (currency1).
contract ConfigureAndInitializePariHook is Script {
    using PoolIdLibrary for PoolKey;

    bytes32 internal constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    uint256 internal constant DEFAULT_BAND_WIDTH = 2_000_000; // $2.00
    uint256 internal constant DEFAULT_WINDOW_DURATION = 60; // 60s
    uint256 internal constant DEFAULT_FROZEN_WINDOWS = 3;
    uint256 internal constant DEFAULT_MAX_STAKE_PER_CELL = 100_000_000_000; // $100k
    uint256 internal constant DEFAULT_FEE_BPS = 200; // 2%
    uint256 internal constant DEFAULT_MIN_POOL_THRESHOLD = 1_000_000; // $1.00

    function run() external {
        uint256 adminPrivateKey = vm.envUint("PRIVATE_KEY");
        address hookAddress = vm.envAddress("PARIHOOK_ADDRESS");

        PariHook hook = PariHook(payable(hookAddress));
        IPoolManager poolManager = hook.POOL_MANAGER();
        IPyth pyth = hook.PYTH_ORACLE();

        uint256 chainId = block.chainid;
        require(chainId == 8453 || chainId == 84532, "Unsupported chain");

        Currency currency0 = Currency.wrap(address(0));
        Currency currency1 = Currency.wrap(_resolveUsdcAddress(chainId));

        PoolKey memory poolKey =
            PoolKey({currency0: currency0, currency1: currency1, fee: 0, tickSpacing: 60, hooks: IHooks(hookAddress)});
        PoolId poolId = poolKey.toId();

        (
            bytes32 existingFeedId,
            uint256 existingBandWidth,
            uint256 existingWindowDuration,
            uint256 existingFrozenWindows,
            uint256 existingMaxStakePerCell,
            uint256 existingFeeBps,
            uint256 existingGridEpoch,
            address existingUsdcToken,
            uint256 existingMinPoolThreshold
        ) = hook.gridConfigs(poolId);

        uint256 bandWidth = vm.envOr("GRID_BAND_WIDTH", DEFAULT_BAND_WIDTH);
        uint256 windowDuration = vm.envOr("GRID_WINDOW_DURATION", DEFAULT_WINDOW_DURATION);
        uint256 frozenWindows = vm.envOr("GRID_FROZEN_WINDOWS", DEFAULT_FROZEN_WINDOWS);
        uint256 maxStakePerCell = vm.envOr("GRID_MAX_STAKE_PER_CELL", DEFAULT_MAX_STAKE_PER_CELL);
        uint256 feeBps = vm.envOr("GRID_FEE_BPS", DEFAULT_FEE_BPS);
        uint256 minPoolThreshold = vm.envOr("GRID_MIN_POOL_THRESHOLD", DEFAULT_MIN_POOL_THRESHOLD);
        uint256 gridEpoch = vm.envOr("GRID_EPOCH", _defaultGridEpoch());

        uint160 sqrtPriceX96 =
            SafeCast.toUint160(vm.envOr("INITIALIZE_SQRT_PRICE_X96", uint256(_sqrtPriceX96FromPyth(pyth))));

        console.log("\n============================================");
        console.log("  PARIHOOK CONFIGURE + INITIALIZE");
        console.log("============================================\n");
        console.log("Hook:", hookAddress);
        console.log("PoolManager:", address(poolManager));
        console.log("PoolId:", vm.toString(PoolId.unwrap(poolId)));
        console.log("currency0 (native):", Currency.unwrap(currency0));
        console.log("currency1 (USDC):", Currency.unwrap(currency1));
        console.log("gridEpoch:", gridEpoch);
        console.log("sqrtPriceX96:", sqrtPriceX96);
        console.log("");

        vm.startBroadcast(adminPrivateKey);

        if (existingBandWidth == 0) {
            hook.configureGrid(
                poolKey,
                ETH_USD_FEED_ID,
                bandWidth,
                windowDuration,
                frozenWindows,
                maxStakePerCell,
                feeBps,
                minPoolThreshold,
                gridEpoch,
                Currency.unwrap(currency1)
            );
            console.log("Configured grid.");
        } else {
            console.log("Grid already configured. Skipping configureGrid().");
            console.log("Existing feedId:", vm.toString(existingFeedId));
            console.log("Existing bandWidth:", existingBandWidth);
            console.log("Existing windowDuration:", existingWindowDuration);
            console.log("Existing frozenWindows:", existingFrozenWindows);
            console.log("Existing maxStakePerCell:", existingMaxStakePerCell);
            console.log("Existing feeBps:", existingFeeBps);
            console.log("Existing gridEpoch:", existingGridEpoch);
            console.log("Existing usdcToken:", existingUsdcToken);
            console.log("Existing minPoolThreshold:", existingMinPoolThreshold);
        }

        (uint160 existingSqrtPriceX96,,,) = StateLibrary.getSlot0(poolManager, poolId);
        if (existingSqrtPriceX96 == 0) {
            int24 tick = poolManager.initialize(poolKey, sqrtPriceX96);
            console.log("Initialized pool at tick:", tick);
        } else {
            console.log("Pool already initialized. Existing sqrtPriceX96:", existingSqrtPriceX96);
        }

        vm.stopBroadcast();
    }

    function _resolveUsdcAddress(uint256 chainId) internal view returns (address) {
        if (chainId == 8453) {
            return vm.envOr("USDC_ADDRESS", address(0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913));
        }
        return vm.envOr("USDC_ADDRESS", address(0x036CbD53842c5426634e7929541eC2318f3dCF7e));
    }

    function _defaultGridEpoch() internal view returns (uint256) {
        // Conservative default: 15 minutes from the latest block timestamp, aligned to a minute boundary.
        return ((block.timestamp / 60) + 15) * 60;
    }

    function _sqrtPriceX96FromPyth(IPyth pyth) internal view returns (uint160) {
        PythStructs.Price memory price = pyth.getPriceUnsafe(ETH_USD_FEED_ID);
        uint256 priceUsdc6 = _convertToUsdc6(price.price, price.expo);
        uint256 ratioX192 = FullMath.mulDiv(priceUsdc6, 2 ** 192, 1e18);
        return SafeCast.toUint160(Math.sqrt(ratioX192));
    }

    function _convertToUsdc6(int64 pythPrice, int32 pythExpo) internal pure returns (uint256) {
        require(pythPrice > 0, "Invalid non-positive Pyth price");

        uint256 absPrice = SafeCast.toUint256(int256(pythPrice));
        int32 exponentAdjustment = pythExpo + 6;

        if (exponentAdjustment >= 0) {
            return absPrice * (10 ** SafeCast.toUint256(int256(exponentAdjustment)));
        }

        return absPrice / (10 ** SafeCast.toUint256(int256(-exponentAdjustment)));
    }
}
