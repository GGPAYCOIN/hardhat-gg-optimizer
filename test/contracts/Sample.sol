// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Intentionally messy contract used to test the gg-optimizer analyzer.
contract Sample {
    address public owner;
    uint256 public total = 0;
    mapping(address => uint256) public balances;

    constructor() {
        owner = msg.sender;
    }

    function setOwner(address newOwner) public {
        // no access control on a state-changing external-callable function
        owner = newOwner;
    }

    function authViaOrigin() public view returns (bool) {
        // insecure: tx.origin auth
        return tx.origin == owner;
    }

    function deposit() public payable {
        require(msg.value > 0, "must send eth");
        balances[msg.sender] += msg.value;
        total += msg.value;
    }

    function withdrawAll() public {
        uint256 amount = balances[msg.sender];
        // unchecked low-level call + native transfer patterns
        (bool ok, ) = msg.sender.call{value: amount}("");
        payable(msg.sender).transfer(amount);
        balances[msg.sender] = 0;
    }

    function sumMany(uint256[] memory items) public pure returns (uint256) {
        uint256 acc = 0;
        for (uint256 i = 0; i < items.length; i++) {
            acc += items[i];
        }
        return acc;
    }

    function randomWinner(uint256 n) public view returns (uint256) {
        // insecure randomness
        return uint256(blockhash(block.number - 1)) % n;
    }
}
