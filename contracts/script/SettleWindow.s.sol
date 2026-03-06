// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";

/**
 * @title SettleWindow
 * @notice Attempt to settle window 891
 *
 * Usage:
 * ------
 * forge script script/SettleWindow.s.sol:SettleWindow \
 *   --rpc-url $BASE_SEPOLIA_RPC_URL \
 *   --broadcast \
 *   -vv
 *
 * Note: This will likely VOID the window because we can't provide
 * historical Pyth VAA data easily on testnet. In production, a keeper
 * would fetch the exact VAA from Hermes API at the window close time.
 */
contract SettleWindow is Script {
    // Deployed contracts
    PariHook public constant PARI_HOOK = PariHook(0xdbB492353B57698a5443bF1846F00c71EFA41824);

    function run() public {
        uint256 userPrivateKey = vm.envUint("PRIVATE_KEY");

        console.log("\n============================================");
        console.log("  SETTLE WINDOW 891");
        console.log("  Base Sepolia Testnet");
        console.log("============================================\n");

        // Create pool key
        Currency currency0 = Currency.wrap(address(0x0000000000000000000000000000000000000001));
        Currency currency1 = Currency.wrap(address(0x036CbD53842c5426634e7929541eC2318f3dCF7e));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(PARI_HOOK))
        });

        uint256 targetWindow = 891;

        console.log("Target Window:", targetWindow);
        console.log("");

        console.log("Attempting settlement with empty Pyth data...");
        console.log("(This will likely void the window)");
        console.log("");

        vm.startBroadcast(userPrivateKey);

        try PARI_HOOK.settle(poolKey, targetWindow, hex"") {
            console.log("[OK] Settlement succeeded!");
        } catch Error(string memory reason) {
            console.log("[ERROR] Settlement failed:", reason);
        } catch {
            console.log("[ERROR] Settlement failed with low-level error");
        }

        vm.stopBroadcast();

        // Check final status
        (uint256 totalPool, bool settled, bool voided, uint256 winningCell, uint256 redemptionRate) =
            PARI_HOOK.getWindow(poolKey, targetWindow);

        console.log("");
        console.log("Final Window Status:");
        console.log("  Total Pool:", totalPool);
        console.log("  Settled:", settled);
        console.log("  Voided:", voided);
        console.log("  Winning Cell:", winningCell);
        console.log("  Redemption Rate:", redemptionRate);
        console.log("");

        if (voided) {
            console.log("[RESULT] Window was VOIDED");
            console.log("All participants can claim full refunds");
            console.log("");
            console.log("To claim your refund:");
            console.log("  Call: claimRefund(poolKey, 891)");
        } else if (settled) {
            console.log("[RESULT] Window SETTLED successfully");
            console.log("Winning cell:", winningCell);
            console.log("Winners can claim payouts");
        }

        console.log("");
        console.log("============================================");
        console.log("  SETTLEMENT COMPLETE");
        console.log("============================================\n");
    }
}
