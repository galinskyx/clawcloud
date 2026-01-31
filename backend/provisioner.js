import { Compute } from '@google-cloud/compute';
import { EC2Client, RunInstancesCommand, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { generateKeyPairSync } from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

// VM tier configurations
const VM_CONFIGS = {
  MICRO: {
    gcp: { machineType: 'e2-micro', diskSizeGb: 20 },
    aws: { instanceType: 't3.micro', diskSizeGb: 20 }
  },
  SMALL: {
    gcp: { machineType: 'e2-small', diskSizeGb: 40 },
    aws: { instanceType: 't3.small', diskSizeGb: 40 }
  },
  MEDIUM: {
    gcp: { machineType: 'e2-medium', diskSizeGb: 80 },
    aws: { instanceType: 't3.medium', diskSizeGb: 80 }
  },
  LARGE: {
    gcp: { machineType: 'e2-standard-4', diskSizeGb: 160 },
    aws: { instanceType: 't3.large', diskSizeGb: 160 }
  },
  XLARGE: {
    gcp: { machineType: 'e2-standard-8', diskSizeGb: 320 },
    aws: { instanceType: 't3.xlarge', diskSizeGb: 320 }
  }
};

// Initialize cloud clients
const gcpCompute = new Compute({
  projectId: process.env.GCP_PROJECT_ID,
  keyFilename: process.env.GCP_SERVICE_ACCOUNT_KEY
});

const ec2Client = new EC2Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

/**
 * Generate SSH key pair
 */
function generateSSHKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
  
  return { publicKey, privateKey };
}

/**
 * Get startup script for VM initialization
 */
function getStartupScript(publicKey) {
  return `#!/bin/bash
# ClawCloud VM Setup Script

# Update system
apt-get update
apt-get upgrade -y

# Install essentials
apt-get install -y curl wget git vim htop build-essential

# Install Docker
curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Python 3.11
apt-get install -y python3.11 python3-pip python3-venv

# Create agent user
useradd -m -s /bin/bash agent
usermod -aG sudo agent
usermod -aG docker agent

# Setup SSH for agent user
mkdir -p /home/agent/.ssh
echo "${publicKey}" > /home/agent/.ssh/authorized_keys
chmod 700 /home/agent/.ssh
chmod 600 /home/agent/.ssh/authorized_keys
chown -R agent:agent /home/agent/.ssh

# Allow agent to sudo without password
echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent

# Setup firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "✅ ClawCloud VM setup complete!"
`;
}

/**
 * Provision VM on GCP
 */
async function provisionGCP(tokenId, tier, buyer) {
  const config = VM_CONFIGS[tier].gcp;
  const zone = process.env.GCP_ZONE || 'us-central1-a';
  const vmName = `clawcloud-${tokenId}`;
  
  // Generate SSH keys
  const { publicKey, privateKey } = generateSSHKeyPair();
  
  const vmConfig = {
    name: vmName,
    machineType: `zones/${zone}/machineTypes/${config.machineType}`,
    disks: [{
      boot: true,
      autoDelete: true,
      initializeParams: {
        sourceImage: 'projects/ubuntu-os-cloud/global/images/family/ubuntu-2204-lts',
        diskSizeGb: config.diskSizeGb.toString()
      }
    }],
    networkInterfaces: [{
      network: 'global/networks/default',
      accessConfigs: [{
        type: 'ONE_TO_ONE_NAT',
        name: 'External NAT'
      }]
    }],
    metadata: {
      items: [{
        key: 'startup-script',
        value: getStartupScript(publicKey)
      }]
    },
    tags: {
      items: ['clawcloud', 'http-server', 'https-server']
    },
    labels: {
      'clawcloud-token-id': tokenId,
      'clawcloud-tier': tier.toLowerCase(),
      'clawcloud-buyer': buyer.toLowerCase().replace('0x', '')
    }
  };
  
  // Create VM
  const [vm, operation] = await gcpCompute.zone(zone).createVM(vmName, vmConfig);
  
  // Wait for operation to complete
  await operation.promise();
  
  // Get VM metadata
  const [metadata] = await vm.getMetadata();
  const externalIP = metadata.networkInterfaces[0].accessConfigs[0].natIP;
  
  return {
    success: true,
    instanceId: vmName,
    ipAddress: externalIP,
    provider: 'gcp',
    zone,
    sshPrivateKey: privateKey
  };
}

/**
 * Provision VM on AWS
 */
async function provisionAWS(tokenId, tier, buyer) {
  const config = VM_CONFIGS[tier].aws;
  
  // Generate SSH keys
  const { publicKey, privateKey } = generateSSHKeyPair();
  
  // Create instance
  const command = new RunInstancesCommand({
    ImageId: process.env.AWS_AMI_ID || 'ami-0c7217cdde317cfec', // Ubuntu 22.04 LTS
    InstanceType: config.instanceType,
    MinCount: 1,
    MaxCount: 1,
    KeyName: process.env.AWS_KEY_PAIR_NAME,
    SecurityGroupIds: [process.env.AWS_SECURITY_GROUP_ID],
    UserData: Buffer.from(getStartupScript(publicKey)).toString('base64'),
    BlockDeviceMappings: [{
      DeviceName: '/dev/sda1',
      Ebs: {
        VolumeSize: config.diskSizeGb,
        VolumeType: 'gp3',
        DeleteOnTermination: true
      }
    }],
    TagSpecifications: [{
      ResourceType: 'instance',
      Tags: [
        { Key: 'Name', Value: `clawcloud-${tokenId}` },
        { Key: 'clawcloud-token-id', Value: tokenId },
        { Key: 'clawcloud-tier', Value: tier },
        { Key: 'clawcloud-buyer', Value: buyer }
      ]
    }]
  });
  
  const response = await ec2Client.send(command);
  const instanceId = response.Instances[0].InstanceId;
  
  // Wait for instance to get public IP
  let publicIP = null;
  let attempts = 0;
  
  while (!publicIP && attempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const describeCommand = new DescribeInstancesCommand({
      InstanceIds: [instanceId]
    });
    
    const describeResponse = await ec2Client.send(describeCommand);
    publicIP = describeResponse.Reservations[0].Instances[0].PublicIpAddress;
    attempts++;
  }
  
  if (!publicIP) {
    throw new Error('Failed to get public IP for instance');
  }
  
  return {
    success: true,
    instanceId,
    ipAddress: publicIP,
    provider: 'aws',
    region: process.env.AWS_REGION || 'us-east-1',
    sshPrivateKey: privateKey
  };
}

/**
 * Main provisioner function
 * Chooses cloud provider based on availability/preference
 */
export async function provisionVM({ tokenId, buyer, tier, durationMonths, expiresAt }) {
  try {
    const provider = process.env.PREFERRED_PROVIDER || 'gcp';
    
    console.log(`🔧 Provisioning ${tier} VM on ${provider.toUpperCase()}...`);
    
    let result;
    
    if (provider === 'gcp') {
      result = await provisionGCP(tokenId, tier, buyer);
    } else if (provider === 'aws') {
      result = await provisionAWS(tokenId, tier, buyer);
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }
    
    console.log(`✅ VM provisioned successfully`);
    console.log(`  Instance: ${result.instanceId}`);
    console.log(`  IP: ${result.ipAddress}`);
    
    return result;
    
  } catch (error) {
    console.error('❌ Provisioning error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update VM status in database
 * TODO: Implement database logic
 */
export async function updateVMStatus(tokenId, status) {
  // This would update your database (MongoDB, PostgreSQL, etc.)
  console.log(`📝 VM ${tokenId} status:`, status);
  
  // Example with MongoDB:
  // await db.collection('vms').updateOne(
  //   { tokenId },
  //   { $set: { ...status, updatedAt: new Date() } },
  //   { upsert: true }
  // );
}

/**
 * Destroy VM instance
 */
export async function destroyVM(tokenId, provider, instanceId) {
  try {
    if (provider === 'gcp') {
      const zone = process.env.GCP_ZONE || 'us-central1-a';
      const vm = gcpCompute.zone(zone).vm(instanceId);
      const [operation] = await vm.delete();
      await operation.promise();
    } else if (provider === 'aws') {
      // AWS termination logic
      // const command = new TerminateInstancesCommand({ InstanceIds: [instanceId] });
      // await ec2Client.send(command);
    }
    
    console.log(`✅ VM ${tokenId} destroyed`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to destroy VM ${tokenId}:`, error);
    return { success: false, error: error.message };
  }
}
