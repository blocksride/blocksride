// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RIDE
/// @notice BlocksRide reward token with V1 transfer restrictions.
contract RIDE is ERC20, ERC20Permit, Ownable {
    error TransfersRestricted();
    error ZeroAddress();

    uint256 public constant MAX_SUPPLY = 100_000_000e18;

    /// @notice V1 gate: only whitelisted senders/receivers can transfer.
    bool public transfersRestricted = true;
    mapping(address => bool) public isTransferWhitelisted;

    event TransferWhitelistUpdated(address indexed account, bool allowed);
    event TransfersRestrictionUpdated(bool restricted);

    constructor(address initialOwner, address initialDistributor)
        ERC20("BlocksRide", "RIDE")
        ERC20Permit("BlocksRide")
        Ownable(initialOwner)
    {
        if (initialDistributor == address(0)) revert ZeroAddress();
        isTransferWhitelisted[initialDistributor] = true;
        emit TransferWhitelistUpdated(initialDistributor, true);
        _mint(initialDistributor, MAX_SUPPLY);
    }

    function setTransferWhitelist(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isTransferWhitelisted[account] = allowed;
        emit TransferWhitelistUpdated(account, allowed);
    }

    function setTransfersRestricted(bool restricted) external onlyOwner {
        transfersRestricted = restricted;
        emit TransfersRestrictionUpdated(restricted);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (transfersRestricted && from != address(0) && to != address(0)) {
            if (!isTransferWhitelisted[from] && !isTransferWhitelisted[to]) {
                revert TransfersRestricted();
            }
        }
        super._update(from, to, value);
    }
}
