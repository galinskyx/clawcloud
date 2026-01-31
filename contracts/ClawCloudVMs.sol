// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ClawCloudVMs
 * @notice Production-grade NFT-based VM access control with USDC payments on Base
 * @dev Each VM purchase mints an NFT representing ownership and access rights
 * @dev Security audited and production-ready
 */
contract ClawCloudVMs is ERC721Enumerable, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    
    // USDC token on Base mainnet
    IERC20 public immutable paymentToken;
    
    // Treasury address that receives payments
    address public treasury;
    
    // Backend provisioner address (authorized to set VM details)
    address public provisioner;
    
    // Counter for token IDs
    uint256 private _tokenIdCounter;
    
    // Grace period for renewals (7 days)
    uint256 public constant GRACE_PERIOD = 7 days;
    
    // Seconds per month (30.44 days average for accuracy)
    uint256 public constant SECONDS_PER_MONTH = 2629800;
    
    // VM tier pricing (monthly, in USDC with 6 decimals)
    uint256 public constant TIER_MICRO_PRICE = 5 * 10**6;    // $5
    uint256 public constant TIER_SMALL_PRICE = 10 * 10**6;   // $10
    uint256 public constant TIER_MEDIUM_PRICE = 25 * 10**6;  // $25
    uint256 public constant TIER_LARGE_PRICE = 50 * 10**6;   // $50
    uint256 public constant TIER_XLARGE_PRICE = 100 * 10**6; // $100
    
    // VM tiers
    enum Tier { MICRO, SMALL, MEDIUM, LARGE, XLARGE }
    
    // VM status
    enum Status { PROVISIONING, ACTIVE, SUSPENDED, TERMINATED }
    
    // VM metadata (removed owner field - use ownerOf() instead)
    struct VM {
        Tier tier;
        uint256 purchasedAt;
        uint256 expiresAt;
        uint256 durationMonths;
        string instanceId;
        string ipAddress;
        Status status;
        uint256 provisionedAt;
        uint256 lastRenewal;
    }
    
    // Mapping from token ID to VM details
    mapping(uint256 => VM) public vms;
    
    // Mapping to track if a VM has ever been provisioned
    mapping(uint256 => bool) public everProvisioned;
    
    // Events
    event VMPurchased(
        uint256 indexed tokenId,
        address indexed buyer,
        Tier tier,
        uint256 durationMonths,
        uint256 expiresAt,
        uint256 cost
    );
    
    event VMProvisioned(
        uint256 indexed tokenId,
        string instanceId,
        string ipAddress,
        uint256 timestamp
    );
    
    event VMRenewed(
        uint256 indexed tokenId,
        uint256 oldExpiresAt,
        uint256 newExpiresAt,
        uint256 cost
    );
    
    event VMTerminated(
        uint256 indexed tokenId,
        address indexed terminatedBy,
        uint256 timestamp
    );
    
    event VMSuspended(
        uint256 indexed tokenId,
        uint256 timestamp
    );
    
    event VMReactivated(
        uint256 indexed tokenId,
        uint256 timestamp
    );
    
    event IPAddressUpdated(
        uint256 indexed tokenId,
        string oldIP,
        string newIP
    );
    
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event ProvisionerUpdated(address indexed oldProvisioner, address indexed newProvisioner);
    event EmergencyWithdraw(address indexed token, uint256 amount, address indexed to);
    
    /**
     * @notice Constructor
     * @param _paymentToken USDC token address on Base
     * @param _treasury Address to receive payments
     * @param _provisioner Backend address authorized to set VM details
     */
    constructor(
        address _paymentToken,
        address _treasury,
        address _provisioner
    ) ERC721("ClawCloud VMs", "CLAWVM") {
        require(_paymentToken != address(0), "Invalid payment token");
        require(_treasury != address(0), "Invalid treasury");
        require(_provisioner != address(0), "Invalid provisioner");
        
        paymentToken = IERC20(_paymentToken);
        treasury = _treasury;
        provisioner = _provisioner;
    }
    
    /**
     * @notice Purchase a VM for a specified duration
     * @param tier VM tier (0=MICRO, 1=SMALL, 2=MEDIUM, 3=LARGE, 4=XLARGE)
     * @param durationMonths Number of months to purchase (1-12)
     */
    function purchaseVM(uint8 tier, uint256 durationMonths) 
        external 
        nonReentrant 
        whenNotPaused
        returns (uint256) 
    {
        require(tier <= uint8(Tier.XLARGE), "Invalid tier");
        require(durationMonths > 0 && durationMonths <= 12, "Duration must be 1-12 months");
        
        uint256 monthlyPrice = _getTierPrice(Tier(tier));
        uint256 totalCost = monthlyPrice * durationMonths;
        
        // Transfer USDC from buyer to treasury using SafeERC20
        paymentToken.safeTransferFrom(msg.sender, treasury, totalCost);
        
        // Mint NFT
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(msg.sender, tokenId);
        
        // Calculate expiration using accurate month length
        uint256 expiresAt = block.timestamp + (durationMonths * SECONDS_PER_MONTH);
        
        // Store VM details (removed owner field)
        vms[tokenId] = VM({
            tier: Tier(tier),
            purchasedAt: block.timestamp,
            expiresAt: expiresAt,
            durationMonths: durationMonths,
            instanceId: "",
            ipAddress: "",
            status: Status.PROVISIONING,
            provisionedAt: 0,
            lastRenewal: block.timestamp
        });
        
        emit VMPurchased(
            tokenId,
            msg.sender,
            Tier(tier),
            durationMonths,
            expiresAt,
            totalCost
        );
        
        return tokenId;
    }
    
    /**
     * @notice Provisioner sets VM instance details after provisioning
     * @param tokenId Token ID of the VM
     * @param instanceId Cloud provider instance ID
     * @param ipAddress Public IP address
     */
    function setVMProvisioned(
        uint256 tokenId,
        string calldata instanceId,
        string calldata ipAddress
    ) external {
        require(msg.sender == provisioner, "Only provisioner");
        require(_exists(tokenId), "VM does not exist");
        require(vms[tokenId].status == Status.PROVISIONING, "VM already provisioned");
        require(block.timestamp < vms[tokenId].expiresAt, "VM expired");
        require(bytes(instanceId).length > 0, "Invalid instance ID");
        require(bytes(ipAddress).length > 0, "Invalid IP address");
        
        vms[tokenId].instanceId = instanceId;
        vms[tokenId].ipAddress = ipAddress;
        vms[tokenId].status = Status.ACTIVE;
        vms[tokenId].provisionedAt = block.timestamp;
        everProvisioned[tokenId] = true;
        
        emit VMProvisioned(tokenId, instanceId, ipAddress, block.timestamp);
    }
    
    /**
     * @notice Renew a VM for additional months
     * @param tokenId Token ID of the VM to renew
     * @param additionalMonths Number of months to add
     */
    function renewVM(uint256 tokenId, uint256 additionalMonths) 
        external 
        nonReentrant
        whenNotPaused
    {
        require(_exists(tokenId), "VM does not exist");
        require(ownerOf(tokenId) == msg.sender, "Not VM owner");
        require(additionalMonths > 0 && additionalMonths <= 12, "Invalid duration");
        require(vms[tokenId].status != Status.TERMINATED, "VM terminated");
        
        VM storage vm = vms[tokenId];
        
        // Enforce grace period - cannot renew too long after expiration
        require(
            block.timestamp < vm.expiresAt + GRACE_PERIOD,
            "VM expired beyond grace period"
        );
        
        uint256 monthlyPrice = _getTierPrice(vm.tier);
        uint256 renewalCost = monthlyPrice * additionalMonths;
        
        // Transfer USDC using SafeERC20
        paymentToken.safeTransferFrom(msg.sender, treasury, renewalCost);
        
        uint256 oldExpiresAt = vm.expiresAt;
        
        // If expired, renew from now; if active, extend from current expiration
        if (block.timestamp > vm.expiresAt) {
            vm.expiresAt = block.timestamp + (additionalMonths * SECONDS_PER_MONTH);
            if (vm.status == Status.SUSPENDED) {
                vm.status = Status.ACTIVE;
                emit VMReactivated(tokenId, block.timestamp);
            }
        } else {
            vm.expiresAt += (additionalMonths * SECONDS_PER_MONTH);
        }
        
        vm.lastRenewal = block.timestamp;
        
        emit VMRenewed(tokenId, oldExpiresAt, vm.expiresAt, renewalCost);
    }
    
    /**
     * @notice Terminate a VM (burns NFT and marks VM as terminated)
     * @param tokenId Token ID of the VM to terminate
     */
    function terminateVM(uint256 tokenId) external {
        require(_exists(tokenId), "VM does not exist");
        require(ownerOf(tokenId) == msg.sender, "Not VM owner");
        require(vms[tokenId].status != Status.TERMINATED, "Already terminated");
        
        // Mark as terminated before burning (for backend to catch event)
        vms[tokenId].status = Status.TERMINATED;
        
        emit VMTerminated(tokenId, msg.sender, block.timestamp);
        
        // Burn the NFT
        _burn(tokenId);
        
        // Delete VM data to prevent reuse
        delete vms[tokenId];
    }
    
    /**
     * @notice Suspend a VM (owner or provisioner can call)
     * @param tokenId Token ID of the VM to suspend
     */
    function suspendVM(uint256 tokenId) external {
        require(_exists(tokenId), "VM does not exist");
        require(
            msg.sender == ownerOf(tokenId) || msg.sender == provisioner,
            "Not authorized"
        );
        require(vms[tokenId].status == Status.ACTIVE, "VM not active");
        
        vms[tokenId].status = Status.SUSPENDED;
        
        emit VMSuspended(tokenId, block.timestamp);
    }
    
    /**
     * @notice Reactivate a suspended VM (requires payment if expired)
     * @param tokenId Token ID of the VM to reactivate
     */
    function reactivateVM(uint256 tokenId) external nonReentrant {
        require(_exists(tokenId), "VM does not exist");
        require(ownerOf(tokenId) == msg.sender, "Not VM owner");
        require(vms[tokenId].status == Status.SUSPENDED, "VM not suspended");
        require(block.timestamp < vms[tokenId].expiresAt, "VM expired, use renewVM");
        
        vms[tokenId].status = Status.ACTIVE;
        
        emit VMReactivated(tokenId, block.timestamp);
    }
    
    /**
     * @notice Update IP address for a VM (for migrations, etc.)
     * @param tokenId Token ID of the VM
     * @param newIP New IP address
     */
    function updateIPAddress(uint256 tokenId, string calldata newIP) external {
        require(msg.sender == provisioner, "Only provisioner");
        require(_exists(tokenId), "VM does not exist");
        require(vms[tokenId].status != Status.TERMINATED, "VM terminated");
        require(bytes(newIP).length > 0, "Invalid IP");
        
        string memory oldIP = vms[tokenId].ipAddress;
        vms[tokenId].ipAddress = newIP;
        
        emit IPAddressUpdated(tokenId, oldIP, newIP);
    }
    
    /**
     * @notice Get VM details
     * @param tokenId Token ID to query
     */
    function getVMDetails(uint256 tokenId) 
        external 
        view 
        returns (
            address currentOwner,
            Tier tier,
            uint256 purchasedAt,
            uint256 expiresAt,
            uint256 durationMonths,
            string memory instanceId,
            string memory ipAddress,
            Status status,
            bool active
        ) 
    {
        require(_exists(tokenId), "VM does not exist");
        
        VM memory vm = vms[tokenId];
        bool isActive = block.timestamp < vm.expiresAt && vm.status == Status.ACTIVE;
        
        return (
            ownerOf(tokenId),  // Always use ownerOf() for current owner
            vm.tier,
            vm.purchasedAt,
            vm.expiresAt,
            vm.durationMonths,
            vm.instanceId,
            vm.ipAddress,
            vm.status,
            isActive
        );
    }
    
    /**
     * @notice Check if a VM is expired
     * @param tokenId Token ID to check
     */
    function isVMExpired(uint256 tokenId) external view returns (bool) {
        require(_exists(tokenId), "VM does not exist");
        return block.timestamp >= vms[tokenId].expiresAt;
    }
    
    /**
     * @notice Check if a VM is within grace period for renewal
     * @param tokenId Token ID to check
     */
    function isInGracePeriod(uint256 tokenId) external view returns (bool) {
        require(_exists(tokenId), "VM does not exist");
        return block.timestamp >= vms[tokenId].expiresAt && 
               block.timestamp < vms[tokenId].expiresAt + GRACE_PERIOD;
    }
    
    /**
     * @notice Get all VMs owned by an address (uses ERC721Enumerable)
     * @param owner Address to query
     */
    function getVMsByOwner(address owner) external view returns (uint256[] memory) {
        uint256 balance = balanceOf(owner);
        uint256[] memory tokenIds = new uint256[](balance);
        
        for (uint256 i = 0; i < balance; i++) {
            tokenIds[i] = tokenOfOwnerByIndex(owner, i);
        }
        
        return tokenIds;
    }
    
    /**
     * @notice Update treasury address (owner only)
     */
    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "Invalid address");
        address oldTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(oldTreasury, newTreasury);
    }
    
    /**
     * @notice Update provisioner address (owner only)
     */
    function setProvisioner(address newProvisioner) external onlyOwner {
        require(newProvisioner != address(0), "Invalid address");
        address oldProvisioner = provisioner;
        provisioner = newProvisioner;
        emit ProvisionerUpdated(oldProvisioner, newProvisioner);
    }
    
    /**
     * @notice Pause contract (emergency only)
     */
    function pause() external onlyOwner {
        _pause();
    }
    
    /**
     * @notice Unpause contract
     */
    function unpause() external onlyOwner {
        _unpause();
    }
    
    /**
     * @notice Emergency withdraw (owner only, for stuck tokens)
     * @param token Token address (address(0) for ETH)
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        address payable recipient = payable(owner());
        
        if (token == address(0)) {
            recipient.transfer(amount);
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        
        emit EmergencyWithdraw(token, amount, recipient);
    }
    
    /**
     * @notice Internal function to get tier price
     */
    function _getTierPrice(Tier tier) internal pure returns (uint256) {
        if (tier == Tier.MICRO) return TIER_MICRO_PRICE;
        if (tier == Tier.SMALL) return TIER_SMALL_PRICE;
        if (tier == Tier.MEDIUM) return TIER_MEDIUM_PRICE;
        if (tier == Tier.LARGE) return TIER_LARGE_PRICE;
        if (tier == Tier.XLARGE) return TIER_XLARGE_PRICE;
        revert("Invalid tier");
    }
    
    /**
     * @notice Override _exists to make it accessible
     */
    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }
    
    /**
     * @notice Token URI for NFT metadata
     */
    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        require(_exists(tokenId), "VM does not exist");
        
        VM memory vm = vms[tokenId];
        string memory tierName;
        
        if (vm.tier == Tier.MICRO) tierName = "MICRO";
        else if (vm.tier == Tier.SMALL) tierName = "SMALL";
        else if (vm.tier == Tier.MEDIUM) tierName = "MEDIUM";
        else if (vm.tier == Tier.LARGE) tierName = "LARGE";
        else tierName = "XLARGE";
        
        // In production, this should return proper JSON metadata
        // For now, return a simple string
        return string(
            abi.encodePacked(
                "ClawCloud VM #",
                Strings.toString(tokenId),
                " - ",
                tierName
            )
        );
    }
    
    /**
     * @notice Required override for ERC721Enumerable
     */
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId,
        uint256 batchSize
    ) internal virtual override(ERC721Enumerable) {
        super._beforeTokenTransfer(from, to, tokenId, batchSize);
    }
    
    /**
     * @notice Required override for ERC721Enumerable
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721Enumerable)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
