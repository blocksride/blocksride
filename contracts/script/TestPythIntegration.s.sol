// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title TestPythIntegration
 * @notice Script to test Pyth Network integration on Base Sepolia
 *
 * Usage:
 * ------
 * 1. Copy .env.example to .env and add your BASE_SEPOLIA_RPC_URL
 * 2. Load environment: source .env
 * 3. Run script:
 *    forge script script/TestPythIntegration.s.sol:TestPythIntegration \
 *      --fork-url $BASE_SEPOLIA_RPC_URL \
 *      --broadcast \
 *      -vvvv
 *
 * This will:
 * - Connect to real Pyth oracle on Base Sepolia
 * - Fetch current ETH/USD price
 * - Display price in human-readable format
 * - Show Pyth update fee
 * - Test price conversion logic
 */
contract TestPythIntegration is Script {
    // Pyth oracle on Base Sepolia
    IPyth public constant PYTH_ORACLE = IPyth(0xA2aa501b19aff244D90cc15a4Cf739D2725B5729);

    // Price feed IDs
    bytes32 public constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;
    bytes32 public constant BTC_USD_FEED_ID = 0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43;

    function run() public view {
        console.log("\n============================================");
        console.log("  PYTH NETWORK INTEGRATION TEST");
        console.log("  Base Sepolia Testnet");
        console.log("============================================\n");

        // Test ETH/USD price
        testPriceFeed("ETH/USD", ETH_USD_FEED_ID);

        console.log("\n--------------------------------------------\n");

        // Test BTC/USD price
        testPriceFeed("BTC/USD", BTC_USD_FEED_ID);

        console.log("\n--------------------------------------------");
        console.log("  UPDATE FEE INFORMATION");
        console.log("--------------------------------------------\n");

        // Get update fee
        bytes[] memory emptyData = new bytes[](0);
        uint256 updateFee = PYTH_ORACLE.getUpdateFee(emptyData);

        console.log("Update Fee:");
        console.log("  Wei:", updateFee);
        console.log("  ETH:", updateFee / 1e18);
        console.log("  USD (assuming ETH = $2500):", (updateFee * 2500) / 1e18);

        console.log("\n============================================");
        console.log("  INTEGRATION TEST COMPLETE");
        console.log("============================================\n");
    }

    function testPriceFeed(string memory pairName, bytes32 feedId) internal view {
        console.log("Testing:", pairName);
        console.log("Feed ID:", vm.toString(feedId));
        console.log("");

        // Fetch price
        PythStructs.Price memory price = PYTH_ORACLE.getPriceUnsafe(feedId);

        console.log("Raw Pyth Data:");
        console.log("  price (int64):", uint64(price.price));
        console.log("  expo (int32):", uint32(price.expo));
        console.log("  conf (confidence):", price.conf);
        console.log("  publishTime:", price.publishTime);
        console.log("");

        // Convert to human-readable
        uint256 humanPrice = convertPythPrice(uint64(price.price), price.expo);

        console.log("Converted Price:");
        console.log("  $", humanPrice);
        console.log("");

        // Convert to USDC 6-decimal format (for contract use)
        uint256 usdcPrice = convertToUSDC6Decimal(uint64(price.price), price.expo);

        console.log("USDC 6-Decimal Format:");
        console.log("  value:", usdcPrice);
        console.log("  dollars:", usdcPrice / 1e6);
        console.log("");

        // Calculate cell ID (for grid mapping)
        uint256 bandWidth = 2_000_000; // $2.00
        uint256 cellId = usdcPrice / bandWidth;
        uint256 cellLow = cellId * bandWidth;
        uint256 cellHigh = cellLow + bandWidth;

        console.log("Grid Cell Mapping:");
        console.log("  cellId:", cellId);
        console.log("  range: $", cellLow / 1e6, "- $", cellHigh / 1e6);
    }

    /**
     * @notice Convert Pyth price to human-readable format
     * @dev Result = price * 10^expo
     */
    function convertPythPrice(uint64 price, int32 expo) internal pure returns (uint256) {
        if (expo >= 0) {
            return uint256(price) * (10 ** uint32(expo));
        } else {
            return uint256(price) / (10 ** uint32(-expo));
        }
    }

    /**
     * @notice Convert Pyth price to USDC 6-decimal format
     * @dev Matches PariHook._parsePythPrice() logic
     */
    function convertToUSDC6Decimal(uint64 pythPrice, int32 pythExpo) internal pure returns (uint256) {
        // Formula: usdcPrice = pythPrice * 10^(pythExpo + 6)
        int32 exponentAdjustment = pythExpo + 6;

        if (exponentAdjustment >= 0) {
            return uint256(pythPrice) * (10 ** uint32(exponentAdjustment));
        } else {
            return uint256(pythPrice) / (10 ** uint32(-exponentAdjustment));
        }
    }
}
