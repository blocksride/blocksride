// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title PariHook
 * @notice Uniswap V4 Hook implementing parimutuel prediction markets on price movements
 * @dev Single hook manages multiple grids via PoolManager. Each poolId = one grid configuration.
 *      Users bet on price bands (cells) within time windows. Settlement via Pyth oracle.
 */
contract PariHook is IHooks, IUnlockCallback, AccessControl, Pausable, ReentrancyGuard {
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
    bytes4 private constant PYTH_ERR_PRICE_FEED_NOT_FOUND_WITHIN_RANGE =
        bytes4(keccak256("PriceFeedNotFoundWithinRange()"));

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
        address user; // must match field order in BET_INTENT_TYPEHASH
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
        address user; // must match field order in CLAIM_INTENT_TYPEHASH
        bytes32 poolId;
        uint256[] windowIds;
        uint256 nonce;
        uint256 deadline;
    }

    /**
     * @dev Distinguishes token-movement actions inside unlockCallback.
     *      BET_IN:  transferFrom(user → PM) then take(PM → hook)  — hook takes custody
     *      PAY_OUT: transfer(hook → PM)      then take(PM → recipient) — disburse to winner/treasury
     */
    enum CallbackAction {
        BET_IN,
        PAY_OUT
    }

    // =============================================================
    //                      STATE VARIABLES
    // =============================================================

    IPoolManager public immutable POOL_MANAGER;
    IPyth public immutable PYTH_ORACLE;

    /// @notice Grid configurations: poolId => GridConfig
    mapping(PoolId => GridConfig) public gridConfigs;

    /// @notice Window state: poolId => windowId => Window
    mapping(PoolId => mapping(uint256 => Window)) public windows;

    /// @notice Total fees collected per pool: poolId => amount
    mapping(PoolId => uint256) public collectedFees;

    /// @notice Current platform-seeded funds committed across windows: poolId => amount
    mapping(PoolId => uint256) public backstopBalances;

    /// @notice Total amount carried forward from windows without winners (organic + backstop): poolId => amount
    mapping(PoolId => uint256) public rolloverBalances;

    /// @notice Backstop depositor per window — used to refund on void: poolId => windowId => depositor
    mapping(PoolId => mapping(uint256 => address)) public backstopDepositor;

    /// @notice Double-claim prevention: poolId => windowId => user => pushed
    mapping(PoolId => mapping(uint256 => mapping(address => bool))) public payoutPushed;

    /// @notice User nonces for EIP-712 bet signatures: user => nonce
    mapping(address => uint256) public betNonces;

    /// @notice User nonces for EIP-712 claim signatures: user => nonce
    mapping(address => uint256) public claimNonces;

    /// @notice Total amount staked by a user in a window across all cells — used for void refunds
    mapping(PoolId => mapping(uint256 => mapping(address => uint256))) public userWindowStake;

    /// @notice EIP-712 domain separator
    bytes32 public immutable DOMAIN_SEPARATOR;

    /// @notice EIP-712 BetIntent typehash — field order must match relayer signing exactly
    bytes32 public constant BET_INTENT_TYPEHASH = keccak256(
        "BetIntent(address user,bytes32 poolId,uint256 cellId,uint256 windowId,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    /// @notice EIP-712 ClaimIntent typehash
    bytes32 public constant CLAIM_INTENT_TYPEHASH =
        keccak256("ClaimIntent(address user,bytes32 poolId,uint256[] windowIds,uint256 nonce,uint256 deadline)");

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
        PoolId indexed poolId, uint256 indexed windowId, uint256 indexed cellId, address user, uint256 amount
    );

    event WindowSettled(
        PoolId indexed poolId,
        uint256 indexed windowId,
        uint256 winningCell,
        uint256 closingPrice,
        uint256 redemptionRate
    );

    event WindowVoided(PoolId indexed poolId, uint256 indexed windowId, uint256 totalRefundable);

    event WindowRolledOver(
        PoolId indexed poolId, uint256 indexed fromWindowId, uint256 indexed toWindowId, uint256 carryAmount
    );
    event BackstopRolledOver(
        PoolId indexed poolId, uint256 indexed fromWindowId, uint256 indexed toWindowId, uint256 carryBackstopOnly
    );

    event PayoutPushed(PoolId indexed poolId, uint256 indexed windowId, address indexed winner, uint256 amount);

    event PayoutClaimed(PoolId indexed poolId, uint256 indexed windowId, address indexed winner, uint256 amount);

    event RefundClaimed(PoolId indexed poolId, uint256 indexed windowId, address indexed user, uint256 amount);

    event FeeCollected(PoolId indexed poolId, uint256 indexed windowId, uint256 amount);

    event BackstopDeposited(PoolId indexed poolId, uint256 indexed windowId, uint256 amount);

    event FeesWithdrawn(PoolId indexed poolId, address indexed recipient, uint256 amount);

    // =============================================================
    //                        CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initialize PariHook with PoolManager and role addresses
     * @param _poolManager Uniswap V4 PoolManager address
     * @param _pythOracle Pyth Network oracle address (Base: 0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a)
     * @param _admin      Address granted ADMIN_ROLE (protocol parameters; cannot move funds)
     * @param _treasury   Address granted TREASURY_ROLE (fund movement; cannot change params)
     * @param _relayer    Address granted RELAYER_ROLE (gasless bet/claim submission)
     * @dev DEFAULT_ADMIN_ROLE is granted to msg.sender (deployer) — should be a cold hardware wallet
     *      used only to grant/revoke roles. Transfer it after deploy if needed.
     */
    constructor(IPoolManager _poolManager, IPyth _pythOracle, address _admin, address _treasury, address _relayer) {
        POOL_MANAGER = _poolManager;
        PYTH_ORACLE = _pythOracle;

        // Hook address bit pattern validation is skipped — hook address is pre-mined at deploy time.
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
    function beforeInitialize(address, PoolKey calldata key, uint160) external override returns (bytes4) {
        require(msg.sender == address(POOL_MANAGER), "Only PoolManager");

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
        require(gridEpoch % 60 == 0, "gridEpoch must align to minute start");
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

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert("Hook not implemented");
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
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

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
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

    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert("Hook not implemented");
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        revert("Hook not implemented");
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert("Hook not implemented");
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
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
    function placeBet(PoolKey calldata key, uint256 cellId, uint256 windowId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
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

        bytes32 structHash = keccak256(
            abi.encode(
                BET_INTENT_TYPEHASH, user, bytes32(PoolId.unwrap(key.toId())), cellId, windowId, amount, nonce, deadline
            )
        );
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
        uint256 permitAmount, // use type(uint256).max for one-time MAX approval
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

    /**
     * @notice Seed a future window cell on behalf of the treasury/keeper.
     * @dev Bypasses the upper betting zone limit — any window >= current + frozenWindows + 1 is allowed.
     *      This lets the keeper pre-seed liquidity into windows before they enter the standard betting zone.
     * @param key Pool key
     * @param cellId Absolute cell ID to seed
     * @param windowId Target window ID (must be >= current + frozenWindows + 1)
     * @param amount USDC amount to seed
     */
    function seedWindow(PoolKey calldata key, uint256 cellId, uint256 windowId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        onlyRole(TREASURY_ROLE)
    {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];
        require(cfg.bandWidth != 0, "Grid not configured");
        require(amount > 0, "Amount must be > 0");

        uint256 current = block.timestamp < cfg.gridEpoch ? 0 : (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
        uint256 seedableStart = current + cfg.frozenWindows + 1;
        require(windowId >= seedableStart, "Window not seedable yet");

        Window storage window = windows[poolId][windowId];
        require(window.cellStakes[cellId] + amount <= cfg.maxStakePerCell, "Exceeds max stake per cell");

        _transferIn(cfg.usdcToken, msg.sender, amount);

        window.totalPool += amount;
        window.organicPool += amount;
        window.cellStakes[cellId] += amount;
        window.userStakes[cellId][msg.sender] += amount;
        userWindowStake[poolId][windowId][msg.sender] += amount;

        emit BetPlaced(poolId, windowId, cellId, msg.sender, amount);
    }

    // =============================================================
    //                        SETTLEMENT
    // =============================================================

    /**
     * @notice Settle a window using Pyth oracle price. Permissionless — anyone can call after windowEnd.
     * @dev Requires the Pyth update fee up front. Reverts on malformed/underfunded/wrong-feed updates.
     *      Auto-void is only allowed when Pyth reports no price in the target time window.
     *      Rolls over if no bets on the winning cell. Only takes a fee when winStakes > 0.
     * @param key Pool key
     * @param windowId Window to settle
     * @param pythUpdateData Pyth VAA bytes — fetch from Hermes API at timestamp=windowEnd
     */
    function settle(PoolKey calldata key, uint256 windowId, bytes calldata pythUpdateData)
        external
        payable
        nonReentrant
    {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];
        Window storage window = windows[poolId][windowId];

        require(cfg.bandWidth != 0, "Grid not configured");
        require(!window.settled, "Already settled");
        require(!window.voided, "Already voided");
        require(pythUpdateData.length > 0, "Empty Pyth update data");

        // Calculate window end time
        uint256 windowEnd = cfg.gridEpoch + ((windowId + 1) * cfg.windowDuration);
        require(block.timestamp >= windowEnd, "Window not ended");

        // Try to fetch Pyth price at windowEnd timestamp
        // Grace period: accept prices within [windowEnd, windowEnd+10s]
        uint64 minPublishTime = SafeCast.toUint64(windowEnd);
        uint64 maxPublishTime = SafeCast.toUint64(windowEnd + 10);

        bytes[] memory updateDataArray = new bytes[](1);
        updateDataArray[0] = pythUpdateData;
        uint256 updateFee = PYTH_ORACLE.getUpdateFee(updateDataArray);
        require(msg.value >= updateFee, "Insufficient Pyth update fee");
        uint256 excessEth = msg.value - updateFee;

        uint256 closingPrice;
        try this._parsePythPrice{value: updateFee}(
            pythUpdateData, cfg.pythPriceFeedId, minPublishTime, maxPublishTime
        ) returns (
            uint256 price
        ) {
            closingPrice = price;
        } catch (bytes memory reason) {
            // Only auto-void when Pyth explicitly reports no price in this publish-time range.
            if (!_isNoPriceInRangeError(reason)) {
                _bubbleRevert(reason);
            }
            window.voided = true;
            emit WindowVoided(poolId, windowId, window.totalPool);
            _refundExcessEth(excessEth);
            return;
        }

        // Auto-void if organic pool below minimum threshold (prevents dust settlements)
        if (window.organicPool < cfg.minPoolThreshold) {
            window.voided = true;
            emit WindowVoided(poolId, windowId, window.totalPool);
            _refundExcessEth(excessEth);
            return;
        }

        // Calculate winning cell from closing price
        uint256 winningCell = closingPrice / cfg.bandWidth;
        uint256 winStakes = window.cellStakes[winningCell];

        // Rollover if no bets on winning cell — carry pool to next window
        if (winStakes == 0) {
            _rollover(poolId, windowId, windowId + 1);
            _refundExcessEth(excessEth);
            return;
        }

        // Calculate fee (only taken when there are winners)
        uint256 fee = (window.totalPool * cfg.feeBps) / BPS_DENOMINATOR;
        uint256 netPool = window.totalPool - fee;

        // Calculate redemption rate: how much each staked USDC returns
        uint256 redemptionRate = (netPool * REDEMPTION_PRECISION) / winStakes;

        // Store settlement results
        window.winningCell = winningCell;
        window.redemptionRate = redemptionRate;
        window.settled = true;

        // Update fee accounting
        collectedFees[poolId] += fee;

        emit FeeCollected(poolId, windowId, fee);
        emit WindowSettled(poolId, windowId, winningCell, closingPrice, redemptionRate);

        // Refund any excess ETH the caller sent above Pyth's required update fee.
        _refundExcessEth(excessEth);
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
    function pushPayouts(PoolKey calldata key, uint256 windowId, address[] calldata winners)
        external
        onlyRole(TREASURY_ROLE)
    {
        PoolId poolId = key.toId();
        Window storage window = windows[poolId][windowId];
        GridConfig storage cfg = gridConfigs[poolId];

        require(window.settled, "Window not settled");

        uint256 winningCell = window.winningCell;
        uint256 rate = window.redemptionRate;

        for (uint256 i = 0; i < winners.length; i++) {
            address winner = winners[i];
            if (payoutPushed[poolId][windowId][winner]) continue;

            uint256 stake = window.userStakes[winningCell][winner];
            if (stake == 0) continue;

            uint256 payout = (stake * rate) / REDEMPTION_PRECISION;
            payoutPushed[poolId][windowId][winner] = true;
            window.userStakes[winningCell][winner] = 0;

            _transferOut(cfg.usdcToken, winner, payout);
            emit PayoutPushed(poolId, windowId, winner, payout);
        }
    }

    /**
     * @notice Claim winnings from multiple settled windows (pull fallback)
     * @param key Pool key
     * @param windowIds Array of window IDs to claim from
     */
    function claimAll(PoolKey calldata key, uint256[] calldata windowIds) external nonReentrant {
        _claimAll(key, windowIds, msg.sender);
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
        require(block.timestamp <= deadline, "Signature expired");

        uint256 nonce = claimNonces[user];
        bytes32 poolIdBytes = bytes32(PoolId.unwrap(key.toId()));
        bytes32 windowIdsHash = keccak256(abi.encodePacked(windowIds));

        bytes32 structHash =
            keccak256(abi.encode(CLAIM_INTENT_TYPEHASH, user, poolIdBytes, windowIdsHash, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0) && recovered == user, "Invalid signature");

        claimNonces[user]++;
        _claimAll(key, windowIds, user);
    }

    /// @dev Internal payout logic shared by claimAll and claimAllFor.
    function _claimAll(PoolKey calldata key, uint256[] calldata windowIds, address user) internal {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];
        uint256 totalPayout = 0;

        for (uint256 i = 0; i < windowIds.length; i++) {
            uint256 wid = windowIds[i];
            Window storage w = windows[poolId][wid];

            if (!w.settled || w.voided) continue;
            if (payoutPushed[poolId][wid][user]) continue;

            uint256 stake = w.userStakes[w.winningCell][user];
            if (stake == 0) continue;

            uint256 payout = (stake * w.redemptionRate) / REDEMPTION_PRECISION;
            payoutPushed[poolId][wid][user] = true;
            w.userStakes[w.winningCell][user] = 0;

            totalPayout += payout;
            emit PayoutClaimed(poolId, wid, user, payout);
        }

        if (totalPayout > 0) {
            _transferOut(cfg.usdcToken, user, totalPayout);
        }
    }

    /**
     * @notice Claim refund from voided window
     * @param key Pool key
     * @param windowId Voided window ID
     */
    function claimRefund(PoolKey calldata key, uint256 windowId) external nonReentrant {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];

        require(windows[poolId][windowId].voided, "Window not voided");

        uint256 refund = userWindowStake[poolId][windowId][msg.sender];
        require(refund > 0, "No stake to refund");

        userWindowStake[poolId][windowId][msg.sender] = 0;

        _transferOut(cfg.usdcToken, msg.sender, refund);
        emit RefundClaimed(poolId, windowId, msg.sender, refund);
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
    function depositBackstop(PoolKey calldata key, uint256 windowId, uint256 amount) external onlyRole(TREASURY_ROLE) {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];

        _transferIn(cfg.usdcToken, msg.sender, amount);

        windows[poolId][windowId].backstopPool += amount;
        windows[poolId][windowId].totalPool += amount;
        backstopBalances[poolId] += amount;
        backstopDepositor[poolId][windowId] = msg.sender;

        emit BackstopDeposited(poolId, windowId, amount);
    }

    /**
     * @notice Manually void a window when settlement fails or oracle data is unavailable
     * @dev Only ADMIN_ROLE can void windows. Users can claim full refunds from voided windows.
     * @param key Pool key
     * @param windowId Window to void
     */
    function voidWindow(PoolKey calldata key, uint256 windowId) external onlyRole(ADMIN_ROLE) {
        PoolId poolId = key.toId();
        Window storage window = windows[poolId][windowId];

        require(!window.settled, "Window already settled");
        require(!window.voided, "Window already voided");

        window.voided = true;

        emit WindowVoided(poolId, windowId, window.totalPool);
    }

    /**
     * @notice Withdraw collected fees to treasury
     * @param key Pool key
     * @param amount USDC amount to withdraw
     */
    function withdrawFees(PoolKey calldata key, uint256 amount) external onlyRole(TREASURY_ROLE) {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];

        require(amount <= collectedFees[poolId], "Insufficient collected fees");
        collectedFees[poolId] -= amount;

        _transferOut(cfg.usdcToken, msg.sender, amount);
        emit FeesWithdrawn(poolId, msg.sender, amount);
    }

    /// @notice Update protocol fee. Max 10% (1000 bps).
    function setFeeBps(PoolKey calldata key, uint256 feeBps) external onlyRole(ADMIN_ROLE) {
        require(feeBps <= 1000, "Max 10%");
        gridConfigs[key.toId()].feeBps = feeBps;
    }

    /// @notice Update frozen window count (anti-sniping buffer).
    function setFrozenWindows(PoolKey calldata key, uint256 count) external onlyRole(ADMIN_ROLE) {
        require(count >= 1, "Min 1 frozen window");
        gridConfigs[key.toId()].frozenWindows = count;
    }

    /// @notice Update minimum organic pool threshold for void trigger. 0 = disabled.
    function setMinPoolThreshold(PoolKey calldata key, uint256 threshold) external onlyRole(ADMIN_ROLE) {
        gridConfigs[key.toId()].minPoolThreshold = threshold;
    }

    /// @notice Update maximum stake per cell (whale cap).
    function setMaxStakePerCell(PoolKey calldata key, uint256 max) external onlyRole(ADMIN_ROLE) {
        gridConfigs[key.toId()].maxStakePerCell = max;
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
    function getWindow(PoolKey calldata key, uint256 windowId)
        external
        view
        returns (uint256 totalPool, bool settled, bool voided, uint256 winningCell, uint256 redemptionRate)
    {
        Window storage w = windows[key.toId()][windowId];
        return (w.totalPool, w.settled, w.voided, w.winningCell, w.redemptionRate);
    }

    /**
     * @notice Returns true if the user has unclaimed winnings for the window.
     *         Used by frontend for "Pending Claims" badge.
     */
    function hasPendingClaim(PoolKey calldata key, uint256 windowId, address user) external view returns (bool) {
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
    function getPendingClaims(PoolKey calldata key, uint256[] calldata windowIds, address user)
        external
        view
        returns (uint256 totalUnclaimed)
    {
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
        uint256 current = block.timestamp < cfg.gridEpoch ? 0 : (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
        start = current + cfg.frozenWindows + 1;
        end = current + cfg.frozenWindows + 3;
    }

    /**
     * @notice Get user's stake in a specific cell (single lookup).
     */
    function getUserStake(PoolKey calldata key, uint256 windowId, uint256 cellId, address user)
        external
        view
        returns (uint256)
    {
        return windows[key.toId()][windowId].userStakes[cellId][user];
    }

    /**
     * @notice Get total stakes on a specific cell (single lookup).
     */
    function getCellStake(PoolKey calldata key, uint256 windowId, uint256 cellId) external view returns (uint256) {
        return windows[key.toId()][windowId].cellStakes[cellId];
    }

    /**
     * @notice Returns stake totals for an explicit list of cellIds in a window.
     *         Frontend calls with the visible cell range for live multiplier display.
     * @param cellIds Absolute cell IDs to query (frontend supplies the visible range)
     */
    function getCellStakes(PoolKey calldata key, uint256 windowId, uint256[] calldata cellIds)
        external
        view
        returns (uint256[] memory stakes)
    {
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
    function getUserStakes(PoolKey calldata key, uint256 windowId, address user, uint256[] calldata cellIds)
        external
        view
        returns (uint256[] memory stakes)
    {
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
    function calculatePayout(PoolKey calldata key, uint256 windowId, uint256 cellId, address user)
        external
        view
        returns (uint256)
    {
        Window storage w = windows[key.toId()][windowId];
        if (!w.settled || w.voided) return 0;
        if (cellId != w.winningCell) return 0;
        uint256 stake = w.userStakes[cellId][user];
        return (stake * w.redemptionRate) / REDEMPTION_PRECISION;
    }

    /**
     * @notice Get live parimutuel multiplier for a cell
     * @param key Pool key
     * @param windowId Window ID
     * @param cellId Cell ID
     * @return Multiplier in 1e18 precision (e.g., 1.5e18 = 1.5x)
     */
    function getLiveMultiplier(PoolKey calldata key, uint256 windowId, uint256 cellId) external view returns (uint256) {
        PoolId poolId = key.toId();
        GridConfig storage cfg = gridConfigs[poolId];
        Window storage w = windows[poolId][windowId];
        uint256 stake = w.cellStakes[cellId];
        if (stake == 0) return 0;
        uint256 netPool = (w.totalPool * (BPS_DENOMINATOR - cfg.feeBps)) / BPS_DENOMINATOR;
        return (netPool * REDEMPTION_PRECISION) / stake;
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
    function _placeBet(PoolId poolId, uint256 cellId, uint256 windowId, uint256 amount, address user) internal {
        GridConfig storage cfg = gridConfigs[poolId];
        require(cfg.bandWidth != 0, "Grid not configured");
        require(amount > 0, "Amount must be > 0");

        uint256 current = block.timestamp < cfg.gridEpoch ? 0 : (block.timestamp - cfg.gridEpoch) / cfg.windowDuration;
        uint256 bettableStart = current + cfg.frozenWindows + 1;
        uint256 bettableEnd = current + cfg.frozenWindows + 3;
        require(windowId >= bettableStart && windowId <= bettableEnd, "Window not in betting zone");

        Window storage window = windows[poolId][windowId];
        require(window.cellStakes[cellId] + amount <= cfg.maxStakePerCell, "Exceeds max stake per cell");

        _transferIn(cfg.usdcToken, user, amount);

        window.totalPool += amount;
        window.organicPool += amount;
        window.cellStakes[cellId] += amount;
        window.userStakes[cellId][user] += amount;
        userWindowStake[poolId][windowId][user] += amount;

        emit BetPlaced(poolId, windowId, cellId, user, amount);
    }

    /**
     * @notice Parse Pyth price at specific timestamp
     * @dev Made public payable (not internal) to enable try-catch in settle() and forward msg.value to Pyth
     * @param pythUpdateData Pyth VAA bytes from Hermes API
     * @param priceFeedId Pyth price feed ID
     * @param minPublishTime Minimum acceptable publish timestamp (windowEnd)
     * @param maxPublishTime Maximum acceptable publish timestamp (windowEnd + 10s grace period)
     * @return price Price in USDC base units (6 decimals)
     */
    function _parsePythPrice(
        bytes calldata pythUpdateData,
        bytes32 priceFeedId,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) public payable returns (uint256 price) {
        // Wrap updateData in array format required by Pyth
        bytes[] memory updateDataArray = new bytes[](1);
        updateDataArray[0] = pythUpdateData;

        // Wrap priceFeedId in array
        bytes32[] memory priceIds = new bytes32[](1);
        priceIds[0] = priceFeedId;

        // Call Pyth oracle to parse and verify price at exact timestamp
        // Reverts if no price available in the [minPublishTime, maxPublishTime] window
        PythStructs.PriceFeed[] memory priceFeeds = PYTH_ORACLE.parsePriceFeedUpdates{value: msg.value}(
            updateDataArray, priceIds, minPublishTime, maxPublishTime
        );

        PythStructs.Price memory pythPrice = priceFeeds[0].price;

        // Convert Pyth price format to USDC 6-decimal format
        // Pyth price = pythPrice.price * 10^(pythPrice.expo)
        // Target format = price * 10^6 (USDC has 6 decimals)
        // Formula: targetPrice = pythPrice.price * 10^(pythPrice.expo + 6)
        require(pythPrice.price > 0, "Invalid Pyth price");

        int32 expo = pythPrice.expo;
        int64 rawPrice = pythPrice.price;

        // Calculate exponent adjustment: expo + 6
        int32 expoAdjustment = expo + 6;

        // rawPrice > 0 is validated above; int64 → int256 is widening (safe)
        uint256 absPrice = SafeCast.toUint256(int256(rawPrice));

        if (expoAdjustment >= 0) {
            // Multiply: price * 10^expoAdjustment (expoAdjustment >= 0, so toUint256 safe)
            price = absPrice * (10 ** SafeCast.toUint256(int256(expoAdjustment)));
        } else {
            // Divide: price / 10^(-expoAdjustment) (-expoAdjustment > 0, so toUint256 safe)
            price = absPrice / (10 ** SafeCast.toUint256(int256(-expoAdjustment)));
        }

        require(price > 0, "Price conversion failed");
    }

    /**
     * @notice Roll over pool to next window (no winners)
     * @param poolId Pool identifier
     * @param fromWindowId Source window
     * @param toWindowId Destination window
     */
    function _rollover(PoolId poolId, uint256 fromWindowId, uint256 toWindowId) internal {
        Window storage fromWindow = windows[poolId][fromWindowId];
        Window storage toWindow = windows[poolId][toWindowId];

        uint256 carryAmount = fromWindow.totalPool;
        uint256 carryBackstopOnly = fromWindow.backstopPool;

        // Carry total pool forward for the next window's payout accounting and
        // preserve how much of that carried value came from platform backstop.
        toWindow.totalPool += carryAmount;
        toWindow.backstopPool += carryBackstopOnly;

        // Distinct global totals for auditability:
        // - rolloverBalances tracks all carried value (organic + backstop)
        // - backstopBalances tracks active platform-seeded capital and should
        //   not change when the same funds are merely moved between windows
        rolloverBalances[poolId] += carryAmount;

        // Mark source window as settled (no winning cell, no redemption rate)
        fromWindow.settled = true;

        emit WindowRolledOver(poolId, fromWindowId, toWindowId, carryAmount);
        emit BackstopRolledOver(poolId, fromWindowId, toWindowId, carryBackstopOnly);
    }

    function _isNoPriceInRangeError(bytes memory reason) internal pure returns (bool) {
        if (reason.length < 4) return false;

        bytes4 selector;
        assembly {
            selector := mload(add(reason, 0x20))
        }

        return selector == PYTH_ERR_PRICE_FEED_NOT_FOUND_WITHIN_RANGE;
    }

    function _bubbleRevert(bytes memory reason) internal pure {
        if (reason.length == 0) revert("Pyth parse failed");
        assembly {
            revert(add(reason, 0x20), mload(reason))
        }
    }

    function _refundExcessEth(uint256 amount) internal {
        if (amount == 0) return;

        (bool refunded,) = msg.sender.call{value: amount}("");
        require(refunded, "Excess fee refund failed");
    }

    // =============================================================
    //                  V4 UNLOCK / CALLBACK
    // =============================================================

    /**
     * @notice Moves USDC from `from` into hook custody via the V4 unlock pattern.
     *         Flow: transferFrom(from → PM) + settle + take(PM → hook)
     * @param token  USDC token address
     * @param from   User or depositor address (must have approved hook as spender)
     * @param amount USDC amount (6 decimals)
     */
    function _transferIn(address token, address from, uint256 amount) internal {
        POOL_MANAGER.unlock(abi.encode(CallbackAction.BET_IN, token, from, amount));
    }

    /**
     * @notice Moves USDC from hook custody to `to` via the V4 unlock pattern.
     *         Flow: transfer(hook → PM) + settle + take(PM → to)
     * @param token  USDC token address
     * @param to     Recipient address
     * @param amount USDC amount (6 decimals)
     */
    function _transferOut(address token, address to, uint256 amount) internal {
        POOL_MANAGER.unlock(abi.encode(CallbackAction.PAY_OUT, token, to, amount));
    }

    /**
     * @inheritdoc IUnlockCallback
     * @dev Called by PoolManager in response to POOL_MANAGER.unlock().
     *      Handles two flows:
     *
     *      BET_IN  — user deposits USDC:
     *        1. sync(currency)                    snapshot PM balance
     *        2. transferFrom(user, PM, amount)    user → PM
     *        3. settle()                          PM credits hook (+amount delta)
     *        4. take(currency, hook, amount)      PM → hook  (delta back to 0)
     *
     *      PAY_OUT — hook disburses USDC:
     *        1. sync(currency)                    snapshot PM balance
     *        2. transfer(PM, amount)              hook → PM
     *        3. settle()                          PM credits hook (+amount delta)
     *        4. take(currency, recipient, amount) PM → recipient (delta back to 0)
     *
     *      In both cases the net delta is zero at callback return.
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(POOL_MANAGER), "Only PoolManager");

        (CallbackAction action, address token, address party, uint256 amount) =
            abi.decode(data, (CallbackAction, address, address, uint256));

        Currency currency = Currency.wrap(token);

        if (action == CallbackAction.BET_IN) {
            // Snapshot current balance so settle() measures exactly this transfer.
            POOL_MANAGER.sync(currency);
            require(IERC20(token).transferFrom(party, address(POOL_MANAGER), amount), "USDC transferFrom failed");
            POOL_MANAGER.settle(); // delta += amount (PM credits hook)
            POOL_MANAGER.take(currency, address(this), amount); // delta  = 0     (hook takes custody)
        } else {
            // Hook owns the tokens; move them to PM then route to recipient.
            POOL_MANAGER.sync(currency);
            require(IERC20(token).transfer(address(POOL_MANAGER), amount), "USDC transfer failed");
            POOL_MANAGER.settle(); // delta += amount (PM credits hook)
            POOL_MANAGER.take(currency, party, amount); // delta  = 0     (recipient receives)
        }

        return "";
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
