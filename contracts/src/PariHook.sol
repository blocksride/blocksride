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
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
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
        address user;      // must match field order in BET_INTENT_TYPEHASH
        bytes32 poolId;
        uint256 cellId;
        uint256 windowId;
        uint256 amount;
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
        address user;      // must match field order in CLAIM_INTENT_TYPEHASH
        bytes32 poolId;
        uint256[] windowIds;
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

    /// @notice Per-pool backstop balance: poolId => amount (global, for fee accounting)
    mapping(PoolId => uint256) public backstopBalances;

    /// @notice Backstop depositor per window — used to refund on void: poolId => windowId => depositor
    mapping(PoolId => mapping(uint256 => address)) public backstopDepositor;

    /// @notice Double-claim prevention: poolId => windowId => user => pushed
    mapping(PoolId => mapping(uint256 => mapping(address => bool))) public payoutPushed;

    /// @notice User nonces for EIP-712 signatures: user => nonce
    mapping(address => uint256) public betNonces;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 BetIntent typehash — field order must match relayer signing exactly
    bytes32 public constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(address user,bytes32 poolId,uint256 cellId,uint256 windowId,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @notice EIP-712 ClaimIntent typehash
    bytes32 public constant CLAIM_INTENT_TYPEHASH = keccak256(
        "ClaimIntent(address user,bytes32 poolId,uint256[] windowIds,uint256 nonce,uint256 deadline)"
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
        uint256 gridEpoch,
        uint256 maxStakePerCell,
        uint256 feeBps,
        uint256 minPoolThreshold
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
        uint256 totalRefundable
    );

    event WindowRolledOver(
        PoolId indexed poolId,
        uint256 indexed fromWindowId,
        uint256 indexed toWindowId,
        uint256 carryAmount
    );

    event PayoutPushed(
        PoolId indexed poolId,
        uint256 indexed windowId,
        address indexed winner,
        uint256 amount
    );

    event PayoutClaimed(
        PoolId indexed poolId,
        uint256 indexed windowId,
        address indexed winner,
        uint256 amount
    );

    event RefundClaimed(
        PoolId indexed poolId,
        uint256 indexed windowId,
        address indexed user,
        uint256 amount
    );

    event FeeCollected(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 amount
    );

    event BackstopDeposited(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 amount
    );

    event FeesWithdrawn(
        PoolId indexed poolId,
        address indexed recipient,
        uint256 amount
    );

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initialize PariHook with PoolManager and role addresses
     * @param _poolManager Uniswap V4 PoolManager address
     * @param _admin      Address granted ADMIN_ROLE (protocol parameters; cannot move funds)
     * @param _treasury   Address granted TREASURY_ROLE (fund movement; cannot change params)
     * @param _relayer    Address granted RELAYER_ROLE (gasless bet/claim submission)
     * @dev DEFAULT_ADMIN_ROLE is granted to msg.sender (deployer) — should be a cold hardware wallet
     *      used only to grant/revoke roles. Transfer it after deploy if needed.
     */
    constructor(
        IPoolManager _poolManager,
        address _admin,
        address _treasury,
        address _relayer
    ) {
        poolManager = _poolManager;

        // TODO: Re-enable hook address validation for production deployment
        // Hook address must be mined to have correct bit pattern
        // For testing, we skip validation
        // IHooks(this).validateHookPermissions(
        //     Hooks.Permissions({
        //         beforeInitialize: true,
        //         afterInitialize: false,
        //         beforeAddLiquidity: false,
        //         afterAddLiquidity: false,
        //         beforeRemoveLiquidity: false,
        //         afterRemoveLiquidity: false,
        //         beforeSwap: false,
        //         afterSwap: false,
        //         beforeDonate: false,
        //         afterDonate: false,
        //         beforeSwapReturnDelta: false,
        //         afterSwapReturnDelta: false,
        //         afterAddLiquidityReturnDelta: false,
        //         afterRemoveLiquidityReturnDelta: false
        //     })
        // );

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

        // Role setup — each role held by a separate key
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender); // deployer = cold wallet only
        _grantRole(ADMIN_ROLE, _admin);
        _grantRole(TREASURY_ROLE, _treasury);
        _grantRole(RELAYER_ROLE, _relayer);
    }

    // =============================================================
    //                      HOOK CALLBACKS
    // =============================================================

    /**
     * @notice Hook callback invoked by PoolManager during pool initialization
     * @dev Validates configureGrid() was called first. gridEpoch is already stored as the
     *      admin-specified future timestamp — we do not override it here.
     * @param key Pool key containing currencies and hook address
     */
    function beforeInitialize(
        address,
        PoolKey calldata key,
        uint160
    ) external override returns (bytes4) {
        require(msg.sender == address(poolManager), "Only PoolManager");

        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];

        // bandWidth == 0 → configureGrid() was never called
        require(cfg.bandWidth != 0, "Grid not configured");

        emit GridInitialized(
            poolId,
            cfg.pythPriceFeedId,
            cfg.bandWidth,
            cfg.windowDuration,
            cfg.frozenWindows,
            cfg.gridEpoch,
            cfg.maxStakePerCell,
            cfg.feeBps,
            cfg.minPoolThreshold
        );

        return IHooks.beforeInitialize.selector;
    }

    /**
     * @notice Configure grid parameters for a pool (must be called before pool initialization)
     * @dev Only ADMIN_ROLE can configure grids. gridEpoch must be a future Unix timestamp
     *      aligned to a clean boundary (e.g. next midnight, next hour). Window IDs are computed
     *      as floor((block.timestamp - gridEpoch) / windowDuration), so the epoch anchors all
     *      settlement times.
     * @param key Pool key to configure
     * @param pythPriceFeedId Pyth oracle price feed ID (e.g., ETH/USD)
     * @param bandWidth Price band width in USDC 6-decimals (e.g., 2_000_000 = $2.00)
     * @param windowDuration Window length in seconds (e.g., 60)
     * @param frozenWindows Number of frozen windows before settlement (e.g., 3)
     * @param maxStakePerCell Maximum USDC per cell (e.g., 100_000_000_000 = $100k)
     * @param feeBps Platform fee in basis points (e.g., 200 = 2%)
     * @param minPoolThreshold Minimum pool size to avoid rollover (e.g., 1_000_000 = $1)
     * @param gridEpoch Unix timestamp when window 0 begins (must be > block.timestamp)
     * @param usdcToken USDC token address
     */
    function configureGrid(
        PoolKey calldata key,
        bytes32 pythPriceFeedId,
        uint256 bandWidth,
        uint256 windowDuration,
        uint256 frozenWindows,
        uint256 maxStakePerCell,
        uint256 feeBps,
        uint256 minPoolThreshold,
        uint256 gridEpoch,
        address usdcToken
    ) external onlyRole(ADMIN_ROLE) {
        PoolId poolId = key.toId();

        require(pythPriceFeedId != bytes32(0), "Invalid price feed ID");
        require(bandWidth > 0, "Band width must be > 0");
        require(windowDuration > 0, "Window duration must be > 0");
        require(frozenWindows >= 1 && frozenWindows <= 10, "Frozen windows must be 1-10");
        require(maxStakePerCell > 0, "Max stake must be > 0");
        require(feeBps <= 1000, "Fee cannot exceed 10%");
        require(minPoolThreshold > 0, "Min pool threshold must be > 0");
        require(gridEpoch > block.timestamp, "gridEpoch must be in the future");
        require(usdcToken != address(0), "Invalid USDC address");

        // bandWidth == 0 is the sentinel for "not yet configured"
        require(gridConfigs[poolId].bandWidth == 0, "Grid already configured");

        gridConfigs[poolId] = GridConfig({
            pythPriceFeedId: pythPriceFeedId,
            bandWidth: bandWidth,
            windowDuration: windowDuration,
            frozenWindows: frozenWindows,
            maxStakePerCell: maxStakePerCell,
            feeBps: feeBps,
            gridEpoch: gridEpoch,
            usdcToken: usdcToken,
            minPoolThreshold: minPoolThreshold
        });
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
        _placeBet(key.toId(), cellId, windowId, amount, msg.sender);
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
     * @param sig Packed ECDSA signature (65 bytes: r, s, v)
     */
    function placeBetWithSig(
        PoolKey calldata key,
        uint256 cellId,
        uint256 windowId,
        uint256 amount,
        address user,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        require(block.timestamp <= deadline, "Signature expired");
        require(nonce == betNonces[user], "Invalid nonce");
        betNonces[user]++;

        bytes32 structHash = keccak256(abi.encode(
            BET_INTENT_TYPEHASH,
            user,
            bytes32(PoolId.unwrap(key.toId())),
            cellId,
            windowId,
            amount,
            nonce,
            deadline
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        require(sig.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        bytes memory sigMem = sig;
        assembly {
            r := mload(add(sigMem, 32))
            s := mload(add(sigMem, 64))
            v := byte(0, mload(add(sigMem, 96)))
        }
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == user, "Invalid signature");

        _placeBet(key.toId(), cellId, windowId, amount, user);
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
        uint256 permitAmount,  // use type(uint256).max for one-time MAX approval
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused {
        address usdcToken = gridConfigs[key.toId()].usdcToken;
        if (IERC20(usdcToken).allowance(msg.sender, address(this)) < amount) {
            IERC20Permit(usdcToken).permit(msg.sender, address(this), permitAmount, deadline, v, r, s);
        }
        _placeBet(key.toId(), cellId, windowId, amount, msg.sender);
    }

    // =============================================================
    //                        SETTLEMENT
    // =============================================================

    /**
     * @notice Settle a window using Pyth oracle price. Permissionless — anyone can call after windowEnd.
     * @dev Auto-voids if Pyth price is unavailable within the 10s grace window.
     *      Rolls over if no bets on the winning cell. Only takes a fee when winStakes > 0.
     * @param key Pool key
     * @param windowId Window to settle
     * @param pythUpdateData Pyth VAA bytes — fetch from Hermes API at timestamp=windowEnd
     */
    function settle(
        PoolKey calldata key,
        uint256 windowId,
        bytes calldata pythUpdateData
    ) external payable nonReentrant {
        // TODO: Verify window has ended: windowEnd = gridEpoch + (windowId+1)*windowDuration <= block.timestamp
        // TODO: Verify !windows[poolId][windowId].settled && !windows[poolId][windowId].voided
        // TODO: Parse Pyth price — parsePriceFeedUpdatesUnique(updateData, feedIds,
        //       minPublishTime=windowEnd, maxPublishTime=windowEnd+10)
        //       If Pyth call reverts (no price in window) → auto-void:
        //         windows[poolId][windowId].voided = true
        //         emit WindowVoided(poolId, windowId, windows[poolId][windowId].totalPool)
        //         return
        // TODO: Calculate winningCell = closingPrice / bandWidth (floor division)
        // TODO: If organicPool < minPoolThreshold → auto-void (same path as above)
        // TODO: If cellStakes[winningCell] == 0 → rollover:
        //         carry totalPool to next window, no fee taken
        //         emit WindowRolledOver(poolId, windowId, windowId+1, totalPool)
        //         return
        // TODO: fee = totalPool * feeBps / 10000
        // TODO: netPool = totalPool - fee
        // TODO: redemptionRate = netPool * 1e18 / cellStakes[winningCell]
        // TODO: Store winningCell, redemptionRate, settled=true
        // TODO: emit FeeCollected, emit WindowSettled
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
     * @notice Deposit backstop USDC into a specific window's pool.
     *         Increases winner payout potential. Refunded on void (tracked via backstopDepositor).
     * @param key      Pool key
     * @param windowId Target window to seed
     * @param amount   USDC amount (6 decimals)
     */
    function depositBackstop(
        PoolKey calldata key,
        uint256 windowId,
        uint256 amount
    ) external onlyRole(TREASURY_ROLE) {
        // TODO: Transfer USDC from treasury to poolManager via unlock()
        // TODO: windows[poolId][windowId].backstopPool += amount
        // TODO: windows[poolId][windowId].totalPool += amount
        // TODO: backstopBalances[poolId] += amount
        // TODO: backstopDepositor[poolId][windowId] = msg.sender
        // TODO: emit BackstopDeposited(poolId, windowId, amount)
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

    /// @notice Update protocol fee. Max 10% (1000 bps).
    function setFeeBps(PoolKey calldata key, uint256 feeBps) external onlyRole(ADMIN_ROLE) {
        // TODO: require(feeBps <= 1000, "Max 10%")
        // TODO: gridConfigs[key.toId()].feeBps = feeBps
    }

    /// @notice Update frozen window count (anti-sniping buffer).
    function setFrozenWindows(PoolKey calldata key, uint256 count) external onlyRole(ADMIN_ROLE) {
        // TODO: require(count >= 1, "Min 1 frozen window")
        // TODO: gridConfigs[key.toId()].frozenWindows = count
    }

    /// @notice Update minimum organic pool threshold for void trigger. 0 = disabled.
    function setMinPoolThreshold(PoolKey calldata key, uint256 threshold) external onlyRole(ADMIN_ROLE) {
        // TODO: gridConfigs[key.toId()].minPoolThreshold = threshold
    }

    /// @notice Update maximum stake per cell (whale cap).
    function setMaxStakePerCell(PoolKey calldata key, uint256 max) external onlyRole(ADMIN_ROLE) {
        // TODO: gridConfigs[key.toId()].maxStakePerCell = max
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
     * @notice Returns the current window ID for a pool. Matches architecture.md spec name.
     */
    function currentWindowId(PoolKey calldata key) external view returns (uint256) {
        GridConfig storage cfg = gridConfigs[key.toId()];
        if (block.timestamp < cfg.gridEpoch) return 0;
        return (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
    }

    /// @notice Alias kept for backward-compatibility during development.
    function getCurrentWindow(PoolKey calldata key) external view returns (uint256) {
        GridConfig storage cfg = gridConfigs[key.toId()];
        if (block.timestamp < cfg.gridEpoch) return 0;
        return (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
    }

    /**
     * @notice Returns window state summary. Used by keeper and frontend.
     */
    function getWindow(
        PoolKey calldata key,
        uint256 windowId
    ) external view returns (
        uint256 totalPool,
        bool settled,
        bool voided,
        uint256 winningCell,
        uint256 redemptionRate
    ) {
        Window storage w = windows[key.toId()][windowId];
        return (w.totalPool, w.settled, w.voided, w.winningCell, w.redemptionRate);
    }

    /**
     * @notice Returns true if the user has unclaimed winnings for the window.
     *         Used by frontend for "Pending Claims" badge.
     */
    function hasPendingClaim(
        PoolKey calldata key,
        uint256 windowId,
        address user
    ) external view returns (bool) {
        PoolId poolId = key.toId();
        Window storage w = windows[poolId][windowId];
        if (!w.settled || w.voided) return false;
        if (payoutPushed[poolId][windowId][user]) return false;
        return w.userStakes[w.winningCell][user] > 0;
    }

    /**
     * @notice Returns total unclaimed USDC across multiple windows.
     *         Frontend discovers windowIds via BetPlaced event logs.
     */
    function getPendingClaims(
        PoolKey calldata key,
        uint256[] calldata windowIds,
        address user
    ) external view returns (uint256 totalUnclaimed) {
        PoolId poolId = key.toId();
        for (uint256 i = 0; i < windowIds.length; i++) {
            uint256 wid = windowIds[i];
            Window storage w = windows[poolId][wid];
            if (!w.settled || w.voided) continue;
            if (payoutPushed[poolId][wid][user]) continue;
            uint256 stake = w.userStakes[w.winningCell][user];
            if (stake == 0) continue;
            totalUnclaimed += (stake * w.redemptionRate) / REDEMPTION_PRECISION;
        }
    }

    /**
     * @notice Get bettable window range [start, end]
     * @param key Pool key
     * @return start First bettable window ID
     * @return end Last bettable window ID
     */
    function getBettableWindows(PoolKey calldata key) external view returns (uint256 start, uint256 end) {
        GridConfig storage cfg = gridConfigs[key.toId()];
        uint256 current = block.timestamp < cfg.gridEpoch
            ? 0
            : (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
        start = current + cfg.frozenWindows + 1;
        end = current + cfg.frozenWindows + 3;
    }

    /**
     * @notice Get user's stake in a specific cell (single lookup).
     */
    function getUserStake(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId,
        address user
    ) external view returns (uint256) {
        return windows[key.toId()][windowId].userStakes[cellId][user];
    }

    /**
     * @notice Get total stakes on a specific cell (single lookup).
     */
    function getCellStake(
        PoolKey calldata key,
        uint256 windowId,
        uint256 cellId
    ) external view returns (uint256) {
        return windows[key.toId()][windowId].cellStakes[cellId];
    }

    /**
     * @notice Returns stake totals for an explicit list of cellIds in a window.
     *         Frontend calls with the visible cell range for live multiplier display.
     * @param cellIds Absolute cell IDs to query (frontend supplies the visible range)
     */
    function getCellStakes(
        PoolKey calldata key,
        uint256 windowId,
        uint256[] calldata cellIds
    ) external view returns (uint256[] memory stakes) {
        Window storage w = windows[key.toId()][windowId];
        stakes = new uint256[](cellIds.length);
        for (uint256 i = 0; i < cellIds.length; i++) {
            stakes[i] = w.cellStakes[cellIds[i]];
        }
    }

    /**
     * @notice Returns user stakes for an explicit list of cellIds in a window.
     * @param cellIds Absolute cell IDs to query
     */
    function getUserStakes(
        PoolKey calldata key,
        uint256 windowId,
        address user,
        uint256[] calldata cellIds
    ) external view returns (uint256[] memory stakes) {
        Window storage w = windows[key.toId()][windowId];
        stakes = new uint256[](cellIds.length);
        for (uint256 i = 0; i < cellIds.length; i++) {
            stakes[i] = w.userStakes[cellIds[i]][user];
        }
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
        GridConfig storage cfg = gridConfigs[poolId];
        require(cfg.bandWidth != 0, "Grid not configured");
        require(amount > 0, "Amount must be > 0");

        uint256 current = block.timestamp < cfg.gridEpoch
            ? 0
            : (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
        uint256 bettableStart = current + cfg.frozenWindows + 1;
        uint256 bettableEnd = current + cfg.frozenWindows + 3;
        require(windowId >= bettableStart && windowId <= bettableEnd, "Window not in betting zone");

        Window storage window = windows[poolId][windowId];
        require(window.cellStakes[cellId] + amount <= cfg.maxStakePerCell, "Exceeds max stake per cell");

        require(IERC20(cfg.usdcToken).transferFrom(user, address(this), amount), "USDC transfer failed");

        window.totalPool += amount;
        window.organicPool += amount;
        window.cellStakes[cellId] += amount;
        window.userStakes[cellId][user] += amount;

        emit BetPlaced(poolId, windowId, cellId, user, amount);
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
