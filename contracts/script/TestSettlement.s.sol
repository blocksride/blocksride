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
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title TestSettlement
 * @notice Test window settlement with Pyth oracle
 *
 * Usage:
 * ------
 * forge script script/TestSettlement.s.sol:TestSettlement \
 *   --rpc-url $BASE_SEPOLIA_RPC_URL \
 *   --broadcast \
 *   -vv
 *
 * This will:
 * 1. Check window status
 * 2. Get current Pyth price
 * 3. Attempt settlement (will use getPriceUnsafe for testing)
 * 4. Verify settlement results
 * 5. Check if user won
 */
contract TestSettlement is Script {
    using PoolIdLibrary for PoolKey;

    // Deployed contracts
    PariHook public constant PARI_HOOK = PariHook(0xE6dB8dF1ECa3E26bD8D6f21b64a19db5505D9Db6);
    IPoolManager public constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    IPyth public constant PYTH_ORACLE = IPyth(0xA2aa501b19aff244D90cc15a4Cf739D2725B5729);

    // Constants
    bytes32 public constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    uint256 public constant GRID_EPOCH = 1772985060;
    uint256 public constant WINDOW_DURATION = 60;

    function run() public view {
        address user = vm.addr(vm.envUint("PRIVATE_KEY"));

        console.log("\n============================================");
        console.log("  SETTLEMENT TEST");
        console.log("  Base Sepolia Testnet");
        console.log("============================================\n");

        // Create pool key
        Currency currency0 = Currency.wrap(address(0x036CbD53842c5426634e7929541eC2318f3dCF7e));
        Currency currency1 = Currency.wrap(address(0));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(PARI_HOOK))
        });
        PoolId poolId = poolKey.toId();

        // Our bet was on window 891
        uint256 targetWindow = 891;
        uint256 ourCellId = 1029;

        console.log("Target Window:", targetWindow);
        console.log("Our Cell ID:", ourCellId);
        console.log("Our Price Range: $2,058 - $2,060");
        console.log("");

        // Step 1: Check window status
        console.log("--------------------------------------------");
        console.log("STEP 1: Check Window Status");
        console.log("--------------------------------------------\n");

        (uint256 totalPool, bool settled, bool voided, uint256 winningCell, uint256 redemptionRate) =
            PARI_HOOK.getWindow(poolKey, targetWindow);

        console.log("  Total Pool:", totalPool);
        console.log("  Settled:", settled);
        console.log("  Voided:", voided);
        console.log("  Winning Cell:", winningCell);
        console.log("  Redemption Rate:", redemptionRate);
        console.log("");

        // Step 2: Check timing
        console.log("--------------------------------------------");
        console.log("STEP 2: Check Timing");
        console.log("--------------------------------------------\n");

        (,, uint256 windowDuration,,,, uint256 gridEpoch,,) = PARI_HOOK.gridConfigs(poolId);

        uint256 windowEnd = gridEpoch + ((targetWindow + 1) * windowDuration);
        uint256 currentTime = block.timestamp;

        console.log("  Window End Time:", windowEnd);
        console.log("  Current Time:", currentTime);
        console.log("  Time Since Close:", currentTime > windowEnd ? currentTime - windowEnd : 0, "seconds");
        console.log("");

        if (currentTime < windowEnd) {
            console.log("  [WARN] Window has not closed yet!");
            console.log("  Wait", windowEnd - currentTime, "more seconds");
            return;
        }

        console.log("  [OK] Window has closed!");
        console.log("");

        // Step 3: Get current price
        console.log("--------------------------------------------");
        console.log("STEP 3: Get Current ETH Price");
        console.log("--------------------------------------------\n");

        PythStructs.Price memory pythPrice = PYTH_ORACLE.getPriceUnsafe(ETH_USD_FEED_ID);

        console.log("  Raw Price:", int256(pythPrice.price));
        console.log("  Exponent:", int256(pythPrice.expo));
        console.log("  Publish Time:", pythPrice.publishTime);
        console.log("");

        // Convert to USDC 6-decimal format
        uint256 currentPrice = convertToUsdc6Decimal(pythPrice.price, pythPrice.expo);
        console.log("  Current ETH Price: $", currentPrice / 1e6);
        console.log("");

        // Calculate which cell current price is in
        uint256 currentCellId = currentPrice / 2_000_000;
        console.log("  Current Price Cell:", currentCellId);
        console.log("  Cell Range: $", currentCellId * 2, "- $", (currentCellId + 1) * 2);
        console.log("");

        // Step 4: Check if already settled
        if (settled) {
            console.log("--------------------------------------------");
            console.log("WINDOW ALREADY SETTLED");
            console.log("--------------------------------------------\n");

            console.log("  Winning Cell:", winningCell);
            console.log("  Winning Range: $", winningCell * 2, "- $", (winningCell + 1) * 2);
            console.log("  Redemption Rate:", redemptionRate);
            console.log("");

            // Check if user won
            if (winningCell == ourCellId) {
                console.log("  [SUCCESS] YOU WON!");
                console.log("");

                uint256 userStake = PARI_HOOK.getUserStake(poolKey, targetWindow, ourCellId, user);
                uint256 payout = (userStake * redemptionRate) / 1e18;

                console.log("  Your Stake (raw):", userStake);
                console.log("  Your Stake (USDC):", userStake / 1e6);
                console.log("  Your Payout (raw):", payout);
                console.log("  Your Payout (USDC):", payout / 1e6);
                console.log("  Profit:", payout > userStake ? payout - userStake : 0);
                console.log("");

                // Check if claimed
                console.log("  [ACTION] Call claimAll() if you haven't received winnings yet");
                console.log("");
            } else {
                console.log("  [LOST] Your cell did not win");
                console.log("  Your cell:", ourCellId);
                console.log("  Winning cell:", winningCell);
                console.log("");
            }
        } else if (voided) {
            console.log("--------------------------------------------");
            console.log("WINDOW VOIDED");
            console.log("--------------------------------------------\n");

            console.log("  Window was voided (oracle failure or low pool)");
            console.log("  You can claim a full refund");
            console.log("");
        } else {
            console.log("--------------------------------------------");
            console.log("SETTLEMENT NEEDED");
            console.log("--------------------------------------------\n");

            console.log("  Window is closed but not yet settled");
            console.log("  A keeper needs to call settle() with Pyth VAA");
            console.log("");

            console.log("  To settle manually:");
            console.log("  1. Get Pyth VAA from Hermes API");
            console.log("  2. Call settle(poolKey, windowId, pythVAA)");
            console.log("");

            console.log("  Note: For this test, we're using getPriceUnsafe");
            console.log("  Real settlement requires historical Pyth VAA data");
            console.log("");
        }

        console.log("============================================");
        console.log("  SETTLEMENT TEST COMPLETE");
        console.log("============================================\n");
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
}
