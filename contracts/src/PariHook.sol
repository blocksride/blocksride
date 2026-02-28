// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PariHook
 * @notice Uniswap V4 Hook implementing parimutuel prediction markets on price movements
 * @dev Single hook manages multiple grids via PoolManager. Each poolId = one grid configuration.
 *      Users bet on price bands (cells) within time windows. Settlement via Pyth oracle.
 */
contract PariHook is IHooks, AccessControl, Pausable, ReentrancyGuard {
    using PoolIdLibrary for PoolKey;
    using Hooks for IHooks;

    // =============================================================
    //                      ROLES & CONSTANTS
    // =============================================================

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    uint256 private constant BPS_DENOMINATOR = 10000;
    uint256 private constant REDEMPTION_PRECISION = 1e18;

    // =============================================================
    //                      DATA STRUCTURES
    // =============================================================

    /**
     * @notice Grid configuration for a prediction market pool
     * @param pythPriceFeedId Pyth price feed identifier (e.g., ETH/USD)
     * @param bandWidth Price band width in USDC base units (e.g., 2_000_000 = $2.00)
     * @param windowDuration Window length in seconds (e.g., 60)
     * @param frozenWindows Number of frozen windows before settlement (e.g., 3 = 180s horizon)
     * @param maxStakePerCell Maximum USDC per cell to prevent whale dominance
     * @param feeBps Fee in basis points (e.g., 200 = 2%)
     * @param gridEpoch Unix timestamp of window 0 start
     * @param usdcToken USDC token address for this grid
     * @param minPoolThreshold Minimum pool size to avoid rollover (e.g., $1)
     */
    struct GridConfig {
        bytes32 pythPriceFeedId;
        uint256 bandWidth;
        uint256 windowDuration;
        uint256 frozenWindows;
        uint256 maxStakePerCell;
        uint256 feeBps;
        uint256 gridEpoch;
        address usdcToken;
        uint256 minPoolThreshold;
    }

    /**
     * @notice State of a time window in a grid
     * @param totalPool Total USDC staked (organic + backstop)
     * @param organicPool User-staked USDC (excludes backstop)
     * @param backstopPool Platform-seeded USDC (rollover + dust bets)
     * @param winningCell Absolute cell ID of winning band (0 if not settled)
     * @param redemptionRate Payout multiplier (1e18 precision)
     * @param settled True after settlement completes
     * @param voided True if settlement failed (oracle unavailable, etc.)
     * @param cellStakes Mapping: cellId => total USDC staked on that cell
     * @param userStakes Mapping: cellId => user => USDC staked
     */
    struct Window {
        uint256 totalPool;
        uint256 organicPool;
        uint256 backstopPool;
        uint256 winningCell;
        uint256 redemptionRate;
        bool settled;
        bool voided;
        mapping(uint256 => uint256) cellStakes;
        mapping(uint256 => mapping(address => uint256)) userStakes;
    }

    /**
     * @notice EIP-712 typed data for gasless bet placement
     * @param poolId Pool identifier from PoolKey
     * @param windowId Target window ID
     * @param cellId Absolute cell ID
     * @param amount USDC amount to bet
     * @param user User address placing bet
     * @param nonce Anti-replay nonce
     * @param deadline Signature expiration timestamp
     */
    struct BetIntent {
        PoolId poolId;
        uint256 windowId;
        uint256 cellId;
        uint256 amount;
        address user;
        uint256 nonce;
        uint256 deadline;
    }

    /**
     * @notice EIP-712 typed data for gasless claim
     * @param poolId Pool identifier
     * @param windowIds Array of windows to claim from
     * @param user User address claiming
     * @param nonce Anti-replay nonce
     * @param deadline Signature expiration timestamp
     */
    struct ClaimIntent {
        PoolId poolId;
        uint256[] windowIds;
        address user;
        uint256 nonce;
        uint256 deadline;
    }

    // =============================================================
    //                      STATE VARIABLES
    // =============================================================

    IPoolManager public immutable poolManager;

    /// @notice Grid configurations: poolId => GridConfig
    mapping(PoolId => GridConfig) public gridConfigs;

    /// @notice Window state: poolId => windowId => Window
    mapping(PoolId => mapping(uint256 => Window)) public windows;

    /// @notice Total fees collected per pool: poolId => amount
    mapping(PoolId => uint256) public collectedFees;

    /// @notice Total backstop deposited per pool: poolId => amount
    mapping(PoolId => uint256) public backstopBalances;

    /// @notice User nonces for EIP-712 signatures: user => nonce
    mapping(address => uint256) public nonces;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 BetIntent typehash
    bytes32 public constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(bytes32 poolId,uint256 windowId,uint256 cellId,uint256 amount,address user,uint256 nonce,uint256 deadline)"
    );

    /// @notice EIP-712 ClaimIntent typehash
    bytes32 public constant CLAIM_INTENT_TYPEHASH = keccak256(
        "ClaimIntent(bytes32 poolId,uint256[] windowIds,address user,uint256 nonce,uint256 deadline)"
    );

    // =============================================================
    //                          EVENTS
    // =============================================================

    event GridInitialized(
        PoolId indexed poolId,
        bytes32 pythPriceFeedId,
        uint256 bandWidth,
        uint256 windowDuration,
        uint256 frozenWindows,
        uint256 gridEpoch
    );

    event BetPlaced(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 indexed cellId,
        address user,
        uint256 amount
    );

    event WindowSettled(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 winningCell,
        uint256 closingPrice,
        uint256 redemptionRate
    );

    event WindowVoided(
        PoolId indexed poolId,
        uint256 indexed windowId,
        string reason
    );

    event WindowRolledOver(
        PoolId indexed poolId,
        uint256 indexed fromWindowId,
        uint256 indexed toWindowId,
        uint256 amount
    );

    event PayoutClaimed(
        PoolId indexed poolId,
        uint256 indexed windowId,
        address indexed user,
        uint256 amount
    );

    event RefundClaimed(
        PoolId indexed poolId,
        uint256 indexed windowId,
        address indexed user,
        uint256 amount
    );

    event BackstopDeposited(
        PoolId indexed poolId,
        uint256 amount
    );

    event FeesWithdrawn(
        PoolId indexed poolId,
        address indexed treasury,
        uint256 amount
    );

    event GridConfigUpdated(
        PoolId indexed poolId,
        uint256 frozenWindows,
        uint256 feeBps,
        uint256 minPoolThreshold
    );

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initialize PariHook with PoolManager
     * @param _poolManager Uniswap V4 PoolManager address
     */
    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;

        // Validate hook permissions
        IHooks(this).validateHookPermissions(
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: false,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );

        // EIP-712 domain separator
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("PariHook")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );

        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(TREASURY_ROLE, msg.sender);
    }

    // =============================================================
    //                      HOOK CALLBACKS
    // =============================================================

    /**
     * @notice Hook callback before pool initialization
     * @dev Registers grid configuration for the pool
     * @param sender Address initializing the pool
     * @param key Pool key containing currencies and hook address
     * @param sqrtPriceX96 Initial sqrt price (unused in parimutuel)
     */
    function beforeInitialize(
        address sender,
        PoolKey calldata key,
        uint160 sqrtPriceX96
    ) external override returns (bytes4) {
        // TODO: Decode hookData into GridConfig
        // TODO: Validate configuration parameters
        // TODO: Store gridConfigs[poolId]
        // TODO: Emit GridInitialized event
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(
        address,
        PoolKey calldata,
        uint160,
        int24
    ) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    function beforeAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert("Hook not implemented");
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert("Hook not implemented");
    }

    function beforeSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        bytes calldata
    ) external pure override returns (bytes4, BeforeSwapDelta, uint24) {
        revert("Hook not implemented");
    }

    function afterSwap(
        address,
        PoolKey calldata,
        SwapParams calldata,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, int128) {
        revert("Hook not implemented");
    }

    function beforeDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    function afterDonate(
        address,
        PoolKey calldata,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    // =============================================================
    //                      BET PLACEMENT
    // =============================================================

    /**
     * @notice Place a bet on a specific cell in a future window
     * @dev Direct bet via user's own transaction (MetaMask flow)
     * @param key Pool key identifying the grid
     * @param cellId Absolute cell ID (price / bandWidth)
     * @param windowId Target window ID
     * @param amount USDC amount to bet
     */
    function placeBet(
        PoolKey calldata key,
        uint256 cellId,
        uint256 windowId,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        // TODO: Implement bet placement logic
        // TODO: Validate window is in betting zone (+4, +5, +6)
        // TODO: Transfer USDC from user via poolManager.unlock()
        // TODO: Update window state (totalPool, cellStakes, userStakes)
        // TODO: Emit BetPlaced event
    }

    /**
     * @notice Place bet using EIP-712 signature (gasless flow)
     * @dev Relayer submits transaction on behalf of user
     * @param key Pool key
     * @param cellId Absolute cell ID
     * @param windowId Target window ID
     * @param amount USDC amount
     * @param user User address (signer)
     * @param deadline Signature expiration
     * @param v ECDSA signature component
     * @param r ECDSA signature component
     * @param s ECDSA signature component
     */
    function placeBetWithSig(
        PoolKey calldata key,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        // TODO: Verify EIP-712 signature
        // TODO: Check deadline and nonce
        // TODO: Increment user nonce
        // TODO: Call internal _placeBet()
    }

    /**
     * @notice Place bet with EIP-2612 permit (MetaMask fallback)
     * @dev Combines permit + placeBet in one transaction
     * @param key Pool key
     * @param cellId Absolute cell ID
     * @param windowId Target window ID
     * @param amount USDC amount
     * @param deadline Permit deadline
     * @param v Permit signature component
     * @param r Permit signature component
     * @param s Permit signature component
     */
    function permitAndPlaceBet(
        PoolKey calldata key,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        // TODO: Call USDC.permit() to approve this contract
        // TODO: Call internal _placeBet()
    }

    // =============================================================
    //                        SETTLEMENT
    // =============================================================

    /**
     * @notice Settle a window using Pyth oracle price
     * @dev Permissionless - anyone can call after windowEnd
     * @param key Pool key
     * @param windowId Window to settle
     * @param pythUpdateData Pyth VAA (Verifiable Action Approval) bytes
     */
    function settle(
        PoolKey calldata key,
        uint256 windowId,
        bytes calldata pythUpdateData
    ) external nonReentrant {
        // TODO: Verify window has ended (windowEnd <= block.timestamp)
        // TODO: Verify window not already settled
        // TODO: Parse Pyth price at windowEnd timestamp
        // TODO: Calculate winningCell = closingPrice / bandWidth
        // TODO: Handle rollover if cellStakes[winningCell] == 0
        // TODO: Calculate fee and redemptionRate
        // TODO: Mark window as settled
        // TODO: Emit WindowSettled event
    }

    /**
     * @notice Void a window if settlement fails
     * @dev Only ADMIN_ROLE can void (oracle unavailable, etc.)
     * @param key Pool key
     * @param windowId Window to void
     * @param reason Human-readable reason
     */
    function voidWindow(
        PoolKey calldata key,
        uint256 windowId,
        string calldata reason
    ) external onlyRole(ADMIN_ROLE) {
        // TODO: Mark window as voided
        // TODO: Emit WindowVoided event
    }

    // =============================================================
    //                          PAYOUTS
    // =============================================================

    /**
     * @notice Push payouts to winning users (keeper batch operation)
     * @dev Only TREASURY_ROLE can push payouts
     * @param key Pool key
     * @param windowId Settled window
     * @param winners Array of winning user addresses
     */
    function pushPayouts(
        PoolKey calldata key,
        uint256 windowId,
        address[] calldata winners
    ) external onlyRole(TREASURY_ROLE) {
        // TODO: Verify window is settled
        // TODO: Loop through winners
        // TODO: Calculate payout = userStakes[winningCell][user] * redemptionRate / 1e18
        // TODO: Transfer USDC from poolManager to user
        // TODO: Zero out userStakes[winningCell][user]
        // TODO: Emit PayoutClaimed events
    }

    /**
     * @notice Claim winnings from multiple settled windows (pull fallback)
     * @param key Pool key
     * @param windowIds Array of window IDs to claim from
     */
    function claimAll(
        PoolKey calldata key,
        uint256[] calldata windowIds
    ) external nonReentrant {
        // TODO: Loop through windowIds
        // TODO: Verify window is settled
        // TODO: Calculate payout from userStakes[winningCell][msg.sender]
        // TODO: Transfer USDC from poolManager
        // TODO: Zero out stakes
        // TODO: Emit PayoutClaimed events
    }

    /**
     * @notice Claim winnings for another user using signature (gasless)
     * @param key Pool key
     * @param windowIds Array of window IDs
     * @param user User to claim for
     * @param deadline Signature deadline
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     */
    function claimAllFor(
        PoolKey calldata key,
        uint256[] calldata windowIds,
        address user,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant onlyRole(RELAYER_ROLE) {
        // TODO: Verify EIP-712 ClaimIntent signature
        // TODO: Call internal _claimAll() for user
    }

    /**
     * @notice Claim refund from voided window
     * @param key Pool key
     * @param windowId Voided window ID
     */
    function claimRefund(
        PoolKey calldata key,
        uint256 windowId
    ) external nonReentrant {
        // TODO: Verify window is voided
        // TODO: Refund all cellStakes for msg.sender (sum across all cells)
        // TODO: Transfer USDC from poolManager
        // TODO: Zero out stakes
        // TODO: Emit RefundClaimed event
    }

    // =============================================================
    //                      ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Deposit backstop funds to prevent rollovers
     * @param key Pool key
     * @param amount USDC amount to deposit
     */
    function depositBackstop(
        PoolKey calldata key,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) {
        // TODO: Transfer USDC from treasury to poolManager
        // TODO: Update backstopBalances[poolId]
        // TODO: Emit BackstopDeposited event
    }

    /**
     * @notice Withdraw collected fees to treasury
     * @param key Pool key
     * @param amount USDC amount to withdraw
     */
    function withdrawFees(
        PoolKey calldata key,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) {
        // TODO: Verify amount <= collectedFees[poolId]
        // TODO: Transfer USDC from poolManager to treasury
        // TODO: Decrement collectedFees[poolId]
        // TODO: Emit FeesWithdrawn event
    }

    /**
     * @notice Update grid configuration parameters
     * @param key Pool key
     * @param frozenWindows New frozen window count
     * @param feeBps New fee in basis points
     * @param minPoolThreshold New minimum pool threshold
     */
    function setGridConfig(
        PoolKey calldata key,
        uint256 frozenWindows,
        uint256 feeBps,
        uint256 minPoolThreshold
    ) external onlyRole(ADMIN_ROLE) {
        // TODO: Validate parameters (feeBps <= 1000, etc.)
        // TODO: Update gridConfigs[poolId]
        // TODO: Emit GridConfigUpdated event
    }

    /**
     * @notice Pause all bet placement (emergency)
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    /**
     * @notice Unpause bet placement
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // =============================================================
    //                      VIEW FUNCTIONS
    // =============================================================

    /**
     * @notice Get current window ID for a grid
     * @param key Pool key
     * @return Current window ID
     */
    function getCurrentWindow(PoolKey calldata key) external view returns (uint256) {
        // TODO: Calculate (block.timestamp - gridEpoch) / windowDuration
        return 0;
    }

    /**
     * @notice Get bettable window range [start, end]
     * @param key Pool key
     * @return start First bettable window ID
     * @return end Last bettable window ID
     */
    function getBettableWindows(PoolKey calldata key) external view returns (uint256 start, uint256 end) {
        // TODO: Calculate current + frozenWindows + 1 through current + frozenWindows + 3
        return (0, 0);
    }

    /**
     * @notice Get user's stake in a specific cell
     * @param key Pool key
     * @param windowId Window ID
     * @param cellId Cell ID
     * @param user User address
     * @return USDC amount staked
     */
    function getUserStake(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId,
        address user
    ) external view returns (uint256) {
        PoolId poolId = key.toId();
        return windows[poolId][windowId].userStakes[cellId][user];
    }

    /**
     * @notice Get total stakes on a specific cell
     * @param key Pool key
     * @param windowId Window ID
     * @param cellId Cell ID
     * @return USDC amount staked on cell
     */
    function getCellStake(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId
    ) external view returns (uint256) {
        PoolId poolId = key.toId();
        return windows[poolId][windowId].cellStakes[cellId];
    }

    /**
     * @notice Calculate potential payout for a user's bet
     * @param key Pool key
     * @param windowId Window ID
     * @param cellId Cell ID
     * @param user User address
     * @return Expected payout in USDC (0 if not settled or user didn't win)
     */
    function calculatePayout(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId,
        address user
    ) external view returns (uint256) {
        // TODO: Check if window settled and cellId == winningCell
        // TODO: Return userStakes[cellId][user] * redemptionRate / 1e18
        return 0;
    }

    /**
     * @notice Get live parimutuel multiplier for a cell
     * @param key Pool key
     * @param windowId Window ID
     * @param cellId Cell ID
     * @return Multiplier in 1e18 precision (e.g., 1.5e18 = 1.5x)
     */
    function getLiveMultiplier(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId
    ) external view returns (uint256) {
        // TODO: Calculate (totalPool * (10000 - feeBps) / 10000) * 1e18 / cellStakes[cellId]
        return 0;
    }

    // =============================================================
    //                    INTERNAL HELPERS
    // =============================================================

    /**
     * @notice Internal bet placement logic
     * @param poolId Pool identifier
     * @param cellId Cell ID
     * @param windowId Window ID
     * @param amount USDC amount
     * @param user User address
     */
    function _placeBet(
        PoolId poolId,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        address user
    ) internal {
        // TODO: Implement core bet logic
        // TODO: Validate betting zone
        // TODO: Update window state
        // TODO: Transfer USDC via poolManager.unlock()
    }

    /**
     * @notice Parse Pyth price at specific timestamp
     * @param pythUpdateData Pyth VAA bytes
     * @param priceFeedId Pyth price feed ID
     * @param timestamp Expected price timestamp
     * @return price Price in USDC base units (6 decimals)
     */
    // TODO: Re-add Pyth imports and implement this function
    // function _parsePythPrice(
    //     bytes calldata pythUpdateData,
    //     bytes32 priceFeedId,
    //     uint256 timestamp
    // ) internal returns (uint256 price) {
    //     // TODO: Call pythOracle.parsePriceFeedUpdates()
    //     // TODO: Verify price timestamp matches windowEnd (±2s buffer)
    //     // TODO: Convert Pyth price to USDC 6-decimal format
    //     return 0;
    // }

    /**
     * @notice Roll over pool to next window (no winners)
     * @param poolId Pool identifier
     * @param fromWindowId Source window
     * @param toWindowId Destination window
     */
    function _rollover(
        PoolId poolId,
        uint256 fromWindowId,
        uint256 toWindowId
    ) internal {
        // TODO: Move totalPool to next window's backstopPool
        // TODO: Mark source window as settled (no redemptionRate)
        // TODO: Emit WindowRolledOver event
    }

    /**
     * @notice Verify EIP-712 signature for BetIntent
     * @param intent BetIntent struct
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     * @return True if signature valid
     */
    function _verifyBetSignature(
        BetIntent memory intent,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (bool) {
        // TODO: Reconstruct EIP-712 hash
        // TODO: Recover signer via ecrecover
        // TODO: Verify signer == intent.user
        return false;
    }

    /**
     * @notice Verify EIP-712 signature for ClaimIntent
     * @param intent ClaimIntent struct
     * @param v Signature component
     * @param r Signature component
     * @param s Signature component
     * @return True if signature valid
     */
    function _verifyClaimSignature(
        ClaimIntent memory intent,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal view returns (bool) {
        // TODO: Reconstruct EIP-712 hash
        // TODO: Recover signer via ecrecover
        // TODO: Verify signer == intent.user
        return false;
    }

    /**
     * @notice Calculate absolute cell ID from price
     * @param price Price in USDC base units (6 decimals)
     * @param bandWidth Band width in USDC base units
     * @return cellId Absolute cell identifier
     */
    function _calculateCellId(uint256 price, uint256 bandWidth) internal pure returns (uint256 cellId) {
        return price / bandWidth;
    }

    /**
     * @notice Calculate cell price range [low, high]
     * @param cellId Absolute cell ID
     * @param bandWidth Band width in USDC base units
     * @return low Lower price bound (inclusive)
     * @return high Upper price bound (exclusive)
     */
    function _getCellPriceRange(uint256 cellId, uint256 bandWidth) internal pure returns (uint256 low, uint256 high) {
        low = cellId * bandWidth;
        high = low + bandWidth;
    }
}
