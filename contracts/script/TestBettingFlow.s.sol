// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {PariHook} from "../src/PariHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title TestBettingFlow
 * @notice Complete end-to-end testing of PariHook betting functionality
 *
 * Usage:
 * ------
 * forge script script/TestBettingFlow.s.sol:TestBettingFlow \
 *   --rpc-url $BASE_SEPOLIA_RPC_URL \
 *   --broadcast \
 *   -vvv
 *
 * This script will:
 * 1. Check USDC balance
 * 2. Approve USDC to PariHook
 * 3. Get current ETH price from Pyth
 * 4. Calculate which cell to bet on
 * 5. Place a test bet
 * 6. Verify bet was recorded
 */
contract TestBettingFlow is Script {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;

    // Deployed contracts
    PariHook public constant PARI_HOOK = PariHook(0xE6dB8dF1ECa3E26bD8D6f21b64a19db5505D9Db6);
    IPoolManager public constant POOL_MANAGER = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    IERC20 public constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    function run() public {
        uint256 userPrivateKey = vm.envUint("PRIVATE_KEY");
        address user = vm.addr(userPrivateKey);

        console.log("\n============================================");
        console.log("  PARIHOOK BETTING FLOW TEST");
        console.log("  Base Sepolia Testnet");
        console.log("============================================\n");

        console.log("Test User:", user);
        console.log("");

        // Step 1: Check balances
        console.log("--------------------------------------------");
        console.log("STEP 1: Check Balances");
        console.log("--------------------------------------------\n");

        uint256 usdcBalance = USDC.balanceOf(user);
        uint256 ethBalance = user.balance;

        console.log("  USDC Balance:", usdcBalance);
        console.log("  USDC (human):", usdcBalance / 1e6);
        console.log("  ETH Balance:", ethBalance);
        console.log("");

        require(usdcBalance >= 1_000_000, "Need at least 1 USDC for testing");
        require(ethBalance > 0, "Need some ETH for gas");

        // Step 2: Create pool key (same as keeper/frontend config)
        console.log("--------------------------------------------");
        console.log("STEP 2: Setup Pool Key");
        console.log("--------------------------------------------\n");

        Currency currency0 = Currency.wrap(address(USDC));
        Currency currency1 = Currency.wrap(address(0));

        PoolKey memory poolKey = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(PARI_HOOK))
        });

        PoolId poolId = poolKey.toId();
        console.log("  Pool ID:", vm.toString(PoolId.unwrap(poolId)));
        console.log("");

        // Step 3: Check if we need to approve
        console.log("--------------------------------------------");
        console.log("STEP 3: USDC Approval");
        console.log("--------------------------------------------\n");

        uint256 currentAllowance = USDC.allowance(user, address(PARI_HOOK));
        console.log("  Current allowance:", currentAllowance);

        vm.startBroadcast(userPrivateKey);

        if (currentAllowance < 1_000_000) {
            console.log("  Approving USDC...");
            USDC.approve(address(PARI_HOOK), type(uint256).max);
            console.log("  [OK] Approved unlimited USDC");
        } else {
            console.log("  [OK] Already approved");
        }
        console.log("");

        // Step 4: Get bettable windows
        console.log("--------------------------------------------");
        console.log("STEP 4: Check Bettable Windows");
        console.log("--------------------------------------------\n");

        (uint256 startWindow, uint256 endWindow) = PARI_HOOK.getBettableWindows(poolKey);
        uint256 currentWindow = PARI_HOOK.getCurrentWindow(poolKey);

        console.log("  Current Window:", currentWindow);
        console.log("  Bettable Start:", startWindow);
        console.log("  Bettable End:", endWindow);
        console.log("");

        // Step 5: Calculate cell ID from current price
        // We'll use a simple strategy: bet on the middle cell around current price
        console.log("--------------------------------------------");
        console.log("STEP 5: Calculate Bet Parameters");
        console.log("--------------------------------------------\n");

        // Get current ETH price from Pyth (we know it's around $2,059 from tests)
        // For this test, let's bet on cell 1029 ($2,058-$2,060)
        uint256 targetCellId = 1029;
        uint256 betAmount = 100_000; // 0.1 USDC
        uint256 targetWindow = endWindow; // Bet on LAST available window for buffer

        console.log("  Target Cell ID:", targetCellId);
        console.log("  Cell Price Low: $", targetCellId * 2);
        console.log("  Cell Price High: $", (targetCellId + 1) * 2);
        console.log("  Bet Amount (raw):", betAmount);
        console.log("  Bet Amount (USDC):", betAmount / 1e6);
        console.log("  Target Window:", targetWindow);
        console.log("");

        // Step 6: Place the bet
        console.log("--------------------------------------------");
        console.log("STEP 6: Place Bet");
        console.log("--------------------------------------------\n");

        console.log("  Calling placeBet()...");

        try PARI_HOOK.placeBet(poolKey, targetCellId, targetWindow, betAmount) {
            console.log("  [OK] Bet placed successfully!");
        } catch Error(string memory reason) {
            console.log("  [ERROR] Bet failed:", reason);
            vm.stopBroadcast();
            revert(reason);
        } catch {
            console.log("  [ERROR] Bet failed with low-level error");
            vm.stopBroadcast();
            revert("Bet placement failed");
        }
        console.log("");

        // Step 7: Verify bet was recorded
        console.log("--------------------------------------------");
        console.log("STEP 7: Verify Bet Recorded");
        console.log("--------------------------------------------\n");

        uint256 userStake = PARI_HOOK.getUserStake(poolKey, targetWindow, targetCellId, user);
        uint256 cellStake = PARI_HOOK.getCellStake(poolKey, targetWindow, targetCellId);
        (uint256 totalPool, bool settled, bool voided,,) = PARI_HOOK.getWindow(poolKey, targetWindow);

        console.log("  User Stake on Cell:", userStake);
        console.log("  Total Cell Stake:", cellStake);
        console.log("  Total Window Pool:", totalPool);
        console.log("  Window Settled:", settled);
        console.log("  Window Voided:", voided);
        console.log("");

        require(userStake == betAmount, "User stake mismatch");
        require(cellStake >= betAmount, "Cell stake too low");
        require(totalPool >= betAmount, "Total pool too low");

        console.log("  [OK] Bet verified on-chain!");
        console.log("");

        vm.stopBroadcast();

        // Step 8: Display next steps
        console.log("============================================");
        console.log("  BETTING FLOW TEST COMPLETE");
        console.log("============================================\n");

        console.log("What happened:");
        console.log("  1. Approved USDC to PariHook");
        console.log("  2. Placed bet on cell:", targetCellId);
        console.log("  3. Bet amount:", betAmount / 1e6, "USDC");
        console.log("  4. Bet recorded in window:", targetWindow);
        console.log("");

        console.log("Next steps:");
        console.log("  1. Wait for window", targetWindow, "to close");
        console.log("  2. Call settle() with Pyth VAA");
        console.log("  3. Check if you won!");
        console.log("");

        console.log("Grid Epoch Info:");
        // Note: We can't easily read gridEpoch from the mapping, but we know it from config
        console.log("  Grid starts at epoch: 1772985060");
        console.log("  Window duration: 60 seconds");
        console.log("  Current block.timestamp:", block.timestamp);

        if (block.timestamp < 1772985060) {
            console.log("  [WARN] Grid hasn't started yet!");
            console.log("  Grid starts in:", 1772985060 - block.timestamp, "seconds");
        }
        console.log("");
    }
}
