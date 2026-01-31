const hre = require("hardhat");

async function main() {
  console.log("🚀 Deploying ClawCloud contracts to", hre.network.name);
  
  // Get deployer
  const [deployer] = await hre.ethers.getSigners();
  console.log("📝 Deploying with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", hre.ethers.formatEther(balance), "ETH");
  
  // Contract addresses
  const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  
  // Choose USDC address based on network
  const usdcAddress = hre.network.name === "base" 
    ? USDC_BASE_MAINNET 
    : USDC_BASE_SEPOLIA;
  
  // Treasury address (receives USDC payments)
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  console.log("💵 Treasury address:", treasuryAddress);
  
  // Provisioner address (backend that sets VM details)
  const provisionerAddress = process.env.PROVISIONER_ADDRESS || deployer.address;
  console.log("🔧 Provisioner address:", provisionerAddress);
  
  console.log("💳 USDC token:", usdcAddress);
  
  // Deploy ClawCloudVMs
  console.log("\n📦 Deploying ClawCloudVMs...");
  const ClawCloudVMs = await hre.ethers.getContractFactory("ClawCloudVMs");
  const clawCloudVMs = await ClawCloudVMs.deploy(
    usdcAddress,
    treasuryAddress,
    provisionerAddress
  );
  
  await clawCloudVMs.waitForDeployment();
  const vmContractAddress = await clawCloudVMs.getAddress();
  
  console.log("✅ ClawCloudVMs deployed to:", vmContractAddress);
  
  // Verify contract on Basescan (if not local)
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n⏳ Waiting for block confirmations...");
    await clawCloudVMs.deploymentTransaction().wait(5);
    
    console.log("🔍 Verifying contract on Basescan...");
    try {
      await hre.run("verify:verify", {
        address: vmContractAddress,
        constructorArguments: [
          usdcAddress,
          treasuryAddress,
          provisionerAddress
        ],
      });
      console.log("✅ Contract verified!");
    } catch (error) {
      console.log("⚠️  Verification failed:", error.message);
    }
  }
  
  // Save deployment info
  const deploymentInfo = {
    network: hre.network.name,
    chainId: hre.network.config.chainId,
    clawCloudVMs: vmContractAddress,
    usdc: usdcAddress,
    treasury: treasuryAddress,
    provisioner: provisionerAddress,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    blockNumber: await hre.ethers.provider.getBlockNumber()
  };
  
  console.log("\n📋 Deployment Summary:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Write to file
  const fs = require("fs");
  const path = require("path");
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  
  const filename = `${hre.network.name}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log(`\n💾 Deployment info saved to deployments/${filename}`);
  
  console.log("\n🎉 Deployment complete!");
  console.log("\n📝 Next steps:");
  console.log("1. Update backend/.env with CONTRACT_ADDRESS=" + vmContractAddress);
  console.log("2. Fund the provisioner address with ETH for gas");
  console.log("3. Start the backend event listener");
  console.log("4. Test a VM purchase!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
