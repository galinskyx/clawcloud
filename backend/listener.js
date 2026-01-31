import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { provisionVM, updateVMStatus } from './provisioner.js';

dotenv.config();

// Contract ABI (just the events we need)
const CONTRACT_ABI = [
  "event VMPurchased(uint256 indexed tokenId, address indexed buyer, uint8 tier, uint256 durationMonths, uint256 expiresAt, uint256 cost)",
  "event VMTerminated(uint256 indexed tokenId)",
  "function setVMProvisioned(uint256 tokenId, string calldata instanceId, string calldata ipAddress) external"
];

// Tier names
const TIER_NAMES = ['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE'];

// Initialize provider
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Initialize wallet (for signing transactions to update contract)
const wallet = new ethers.Wallet(process.env.BACKEND_PRIVATE_KEY, provider);

// Initialize contract
const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  CONTRACT_ABI,
  wallet
);

console.log('🎧 ClawCloud Event Listener Started');
console.log('📡 Network:', await provider.getNetwork().then(n => n.name));
console.log('📝 Contract:', process.env.CONTRACT_ADDRESS);
console.log('🔑 Backend Address:', wallet.address);

/**
 * Handle VMPurchased events
 */
async function handleVMPurchased(tokenId, buyer, tier, durationMonths, expiresAt, cost, event) {
  try {
    console.log('\n🛒 VM Purchase Detected!');
    console.log('  Token ID:', tokenId.toString());
    console.log('  Buyer:', buyer);
    console.log('  Tier:', TIER_NAMES[tier]);
    console.log('  Duration:', durationMonths.toString(), 'months');
    console.log('  Cost:', ethers.formatUnits(cost, 6), 'USDC');
    console.log('  Tx:', event.log.transactionHash);
    
    // Provision VM on cloud provider
    console.log('⏳ Provisioning VM...');
    const provisionResult = await provisionVM({
      tokenId: tokenId.toString(),
      buyer,
      tier: TIER_NAMES[tier],
      durationMonths: durationMonths.toString(),
      expiresAt: expiresAt.toString()
    });
    
    if (provisionResult.success) {
      console.log('✅ VM Provisioned!');
      console.log('  Instance ID:', provisionResult.instanceId);
      console.log('  IP Address:', provisionResult.ipAddress);
      console.log('  Provider:', provisionResult.provider);
      
      // Update smart contract with VM details
      console.log('📝 Updating contract...');
      const tx = await contract.setVMProvisioned(
        tokenId,
        provisionResult.instanceId,
        provisionResult.ipAddress
      );
      
      console.log('  Tx submitted:', tx.hash);
      await tx.wait();
      console.log('  ✅ Contract updated!');
      
      // Update database
      await updateVMStatus(tokenId.toString(), {
        status: 'running',
        instanceId: provisionResult.instanceId,
        ipAddress: provisionResult.ipAddress,
        provider: provisionResult.provider,
        sshPrivateKey: provisionResult.sshPrivateKey
      });
      
      console.log('🎉 VM fully provisioned and ready!');
    } else {
      console.error('❌ Provisioning failed:', provisionResult.error);
      
      // Update database with failed status
      await updateVMStatus(tokenId.toString(), {
        status: 'failed',
        error: provisionResult.error
      });
    }
    
  } catch (error) {
    console.error('❌ Error handling VM purchase:', error);
    
    // Update database with error
    await updateVMStatus(tokenId.toString(), {
      status: 'error',
      error: error.message
    });
  }
}

/**
 * Handle VMTerminated events
 */
async function handleVMTerminated(tokenId, event) {
  try {
    console.log('\n🗑️  VM Termination Detected!');
    console.log('  Token ID:', tokenId.toString());
    console.log('  Tx:', event.log.transactionHash);
    
    // TODO: Destroy VM on cloud provider
    console.log('⏳ Destroying VM instance...');
    
    // Update database
    await updateVMStatus(tokenId.toString(), {
      status: 'terminated',
      terminatedAt: new Date().toISOString()
    });
    
    console.log('✅ VM terminated');
    
  } catch (error) {
    console.error('❌ Error handling VM termination:', error);
  }
}

/**
 * Start listening to events
 */
async function startListener() {
  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    console.log('📍 Current block:', currentBlock);
    
    // Listen for VMPurchased events
    contract.on('VMPurchased', handleVMPurchased);
    console.log('✅ Listening for VMPurchased events');
    
    // Listen for VMTerminated events
    contract.on('VMTerminated', handleVMTerminated);
    console.log('✅ Listening for VMTerminated events');
    
    console.log('\n🚀 Event listener ready!\n');
    
    // Catch-all for errors
    contract.on('error', (error) => {
      console.error('❌ Contract error:', error);
    });
    
    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log('\n👋 Shutting down event listener...');
      contract.removeAllListeners();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Failed to start listener:', error);
    process.exit(1);
  }
}

// Start the listener
startListener();

// Health check endpoint (optional)
if (process.env.ENABLE_HEALTH_CHECK === 'true') {
  import('express').then(({ default: express }) => {
    const app = express();
    const port = process.env.HEALTH_CHECK_PORT || 3001;
    
    app.get('/health', (req, res) => {
      res.json({ status: 'ok', listening: true });
    });
    
    app.listen(port, () => {
      console.log(`💊 Health check available at http://localhost:${port}/health`);
    });
  });
}
