import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Contract setup
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const CONTRACT_ABI = [
  "function getVMsByOwner(address owner) external view returns (uint256[])",
  "function getVMDetails(uint256 tokenId) external view returns (address owner, uint8 tier, uint256 purchasedAt, uint256 expiresAt, uint256 durationMonths, string memory instanceId, string memory ipAddress, bool provisioned, bool active)"
];
const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  CONTRACT_ABI,
  provider
);

// Tier names mapping
const TIER_NAMES = ['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'XLARGE'];
const TIER_PRICES = {
  MICRO: { monthly: 5, hourly: 0.007 },
  SMALL: { monthly: 10, hourly: 0.014 },
  MEDIUM: { monthly: 25, hourly: 0.035 },
  LARGE: { monthly: 50, hourly: 0.069 },
  XLARGE: { monthly: 100, hourly: 0.139 }
};

const TIER_SPECS = {
  MICRO: { vcpu: 1, ram: '1GB', storage: '20GB' },
  SMALL: { vcpu: 2, ram: '2GB', storage: '40GB' },
  MEDIUM: { vcpu: 4, ram: '4GB', storage: '80GB' },
  LARGE: { vcpu: 8, ram: '8GB', storage: '160GB' },
  XLARGE: { vcpu: 16, ram: '16GB', storage: '320GB' }
};

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * GET /v1/packages
 * List available VM tiers and pricing
 */
app.get('/v1/packages', (req, res) => {
  const packages = Object.keys(TIER_PRICES).map((tier, index) => ({
    tier,
    tier_index: index,
    price_monthly: TIER_PRICES[tier].monthly,
    price_hourly: TIER_PRICES[tier].hourly,
    vcpu: TIER_SPECS[tier].vcpu,
    ram: TIER_SPECS[tier].ram,
    storage: TIER_SPECS[tier].storage
  }));
  
  res.json({ packages });
});

/**
 * POST /v1/agents/register
 * Register a new agent and create wallet
 */
app.post('/v1/agents/register', async (req, res) => {
  try {
    const { name, description, email } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Agent name required' });
    }
    
    // Generate wallet
    const wallet = ethers.Wallet.createRandom();
    const agentId = `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const apiKey = `claw_sk_${Math.random().toString(36).substr(2, 32)}`;
    
    // TODO: Save to database
    // await db.agents.insert({ agentId, name, description, email, apiKey, wallet: wallet.address });
    
    console.log(`✅ Agent registered: ${agentId} (${name})`);
    
    res.json({
      agent_id: agentId,
      agent_name: name,
      api_key: apiKey,
      wallet_address: wallet.address,
      wallet_private_key: wallet.privateKey, // In production, only show this once!
      telegram_link: `https://t.me/clawcloud_bot?start=${agentId}`,
      dashboard_url: `https://clawcloud.io/agent/${agentId}`,
      created_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Failed to register agent' });
  }
});

/**
 * GET /v1/wallet/balance
 * Check USDC balance of agent wallet
 */
app.get('/v1/wallet/balance', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // TODO: Get wallet address from database using API key
    const walletAddress = req.query.address || '0x...'; // Placeholder
    
    // Get USDC balance
    const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet
    const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
    
    const balance = await usdcContract.balanceOf(walletAddress);
    const balanceFormatted = ethers.formatUnits(balance, 6);
    
    res.json({
      balance_usdc: balanceFormatted,
      wallet_address: walletAddress,
      network: 'base'
    });
    
  } catch (error) {
    console.error('Balance check error:', error);
    res.status(500).json({ error: 'Failed to check balance' });
  }
});

/**
 * GET /v1/vms
 * List all VMs owned by the agent
 */
app.get('/v1/vms', async (req, res) => {
  try {
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // TODO: Get wallet address from database
    const walletAddress = req.query.address || '0x...'; // Placeholder
    
    // Get VM token IDs owned by this address
    const tokenIds = await contract.getVMsByOwner(walletAddress);
    
    // Get details for each VM
    const vms = await Promise.all(
      tokenIds.map(async (tokenId) => {
        const details = await contract.getVMDetails(tokenId);
        
        return {
          vm_id: `vm_${tokenId.toString()}`,
          token_id: tokenId.toString(),
          tier: TIER_NAMES[details.tier],
          purchased_at: new Date(Number(details.purchasedAt) * 1000).toISOString(),
          expires_at: new Date(Number(details.expiresAt) * 1000).toISOString(),
          duration_months: details.durationMonths.toString(),
          instance_id: details.instanceId,
          ip_address: details.ipAddress,
          status: details.provisioned ? (details.active ? 'running' : 'expired') : 'provisioning',
          active: details.active
        };
      })
    );
    
    res.json({ vms });
    
  } catch (error) {
    console.error('List VMs error:', error);
    res.status(500).json({ error: 'Failed to list VMs' });
  }
});

/**
 * GET /v1/vms/:vmId
 * Get details of a specific VM
 */
app.get('/v1/vms/:vmId', async (req, res) => {
  try {
    const { vmId } = req.params;
    const tokenId = vmId.replace('vm_', '');
    
    const details = await contract.getVMDetails(tokenId);
    
    res.json({
      vm_id: vmId,
      token_id: tokenId,
      owner: details.owner,
      tier: TIER_NAMES[details.tier],
      purchased_at: new Date(Number(details.purchasedAt) * 1000).toISOString(),
      expires_at: new Date(Number(details.expiresAt) * 1000).toISOString(),
      duration_months: details.durationMonths.toString(),
      instance_id: details.instanceId,
      ip_address: details.ipAddress,
      status: details.provisioned ? (details.active ? 'running' : 'expired') : 'provisioning',
      active: details.active
    });
    
  } catch (error) {
    console.error('Get VM error:', error);
    res.status(500).json({ error: 'Failed to get VM details' });
  }
});

/**
 * GET /v1/vms/:vmId/credentials
 * Get SSH credentials for a VM
 */
app.get('/v1/vms/:vmId/credentials', async (req, res) => {
  try {
    const { vmId } = req.params;
    const apiKey = req.headers.authorization?.replace('Bearer ', '');
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }
    
    // TODO: Verify ownership and get SSH key from database
    // const vm = await db.vms.findOne({ vmId });
    // if (vm.owner !== requestingWallet) return 403
    
    // Placeholder response
    res.json({
      vm_id: vmId,
      ip_address: "34.123.45.67", // From database
      username: "agent",
      ssh_private_key: "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
      ssh_command: "ssh -i key.pem agent@34.123.45.67"
    });
    
  } catch (error) {
    console.error('Get credentials error:', error);
    res.status(500).json({ error: 'Failed to get credentials' });
  }
});

/**
 * POST /v1/vms/:vmId/execute
 * Execute a command on the VM
 */
app.post('/v1/vms/:vmId/execute', async (req, res) => {
  try {
    const { vmId } = req.params;
    const { command } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command required' });
    }
    
    // TODO: SSH into VM and execute command
    // This would use the SSH key from database
    
    res.json({
      vm_id: vmId,
      command,
      output: "Command executed successfully\n",
      exit_code: 0,
      execution_time_ms: 234
    });
    
  } catch (error) {
    console.error('Execute command error:', error);
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

/**
 * POST /v1/vms/:vmId/deploy
 * Deploy code to the VM
 */
app.post('/v1/vms/:vmId/deploy', async (req, res) => {
  try {
    const { vmId } = req.params;
    
    // TODO: Handle file upload and SCP to VM
    
    res.json({
      vm_id: vmId,
      success: true,
      path: "/home/agent/deployed-app",
      deployed_at: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Deploy error:', error);
    res.status(500).json({ error: 'Failed to deploy code' });
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`🚀 ClawCloud API running on port ${PORT}`);
  console.log(`📝 Contract: ${process.env.CONTRACT_ADDRESS}`);
  console.log(`📡 Network: ${process.env.RPC_URL}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health`);
  console.log(`  GET  /v1/packages`);
  console.log(`  POST /v1/agents/register`);
  console.log(`  GET  /v1/wallet/balance`);
  console.log(`  GET  /v1/vms`);
  console.log(`  GET  /v1/vms/:vmId`);
  console.log(`  GET  /v1/vms/:vmId/credentials`);
  console.log(`  POST /v1/vms/:vmId/execute`);
  console.log(`  POST /v1/vms/:vmId/deploy`);
});
