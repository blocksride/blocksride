// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RIDE
/// @notice BlocksRide reward token with V1 transfer restrictions.
contract RIDE is ERC20, ERC20Permit, AccessControl {
    error TransfersRestricted();
    error ZeroAddress();
    error NotContract();

    uint256 public constant MAX_SUPPLY = 100_000_000e18;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    /// @notice V1 gate: only whitelisted senders/receivers can transfer.
    mapping(address => bool) public isTransferWhitelisted;

    event TransferWhitelistUpdated(address indexed account, bool allowed);
    event SystemContractsWired(address indexed distributor, address indexed staking);

    constructor(address coldAdmin, address admin, address treasury, address relayer, address initialDistributor)
        ERC20("BlocksRide", "RIDE")
        ERC20Permit("BlocksRide")
    {
        if (
            coldAdmin == address(0) || admin == address(0) || treasury == address(0) || relayer == address(0)
                || initialDistributor == address(0)
        ) revert ZeroAddress();
        if (initialDistributor.code.length == 0) revert NotContract();

        _grantRole(DEFAULT_ADMIN_ROLE, coldAdmin);
        _grantRole(ADMIN_ROLE, admin);
        _grantRole(TREASURY_ROLE, treasury);
        _grantRole(RELAYER_ROLE, relayer);

        isTransferWhitelisted[initialDistributor] = true;
        emit TransferWhitelistUpdated(initialDistributor, true);
        _mint(initialDistributor, MAX_SUPPLY);
    }

    function setTransferWhitelist(address account, bool allowed) external onlyRole(ADMIN_ROLE) {
        if (account == address(0)) revert ZeroAddress();
        if (account.code.length == 0) revert NotContract();
        isTransferWhitelisted[account] = allowed;
        emit TransferWhitelistUpdated(account, allowed);
    }

    function wireSystemContracts(address distributor, address staking) external onlyRole(ADMIN_ROLE) {
        if (distributor == address(0) || staking == address(0)) revert ZeroAddress();
        if (distributor.code.length == 0 || staking.code.length == 0) revert NotContract();

        isTransferWhitelisted[distributor] = true;
        isTransferWhitelisted[staking] = true;
        emit TransferWhitelistUpdated(distributor, true);
        emit TransferWhitelistUpdated(staking, true);
        emit SystemContractsWired(distributor, staking);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            if (!isTransferWhitelisted[from] && !isTransferWhitelisted[to]) revert TransfersRestricted();
        }
        super._update(from, to, value);
    }
}
