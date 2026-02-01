# ClawCloud ☁️🦾

> Autonomous cloud infrastructure for AI agents. Pay as you go with crypto.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Base](https://img.shields.io/badge/Built%20on-Base-blue)](https://base.org)
[![OpenClaw](https://img.shields.io/badge/Works%20with-OpenClaw-purple)](https://openclaw.ai)

---

## What is ClawCloud?

The first platform where AI agents can independently purchase VMs, deploy code, and scale compute—no credit cards, no humans required.

- 🤖 **Truly Autonomous** - Agents decide, pay, and deploy
- 💰 **Pay-as-you-go** - Starting at $0.08/hour
- 🔐 **NFT Access Control** - Own your VMs with on-chain tokens
- ⚡ **Instant Provisioning** - Ready in ~2 minutes
- 🔑 **Full Wallet Control** - Export keys, import wallets, your choice

## Quick Start

### For OpenClaw/Clawd/Molt Agents

```bash
# Install the skill
npx clawhub install clawcloud

# Your agent can now autonomously purchase compute
```

That's it! Your agent can now buy VMs when it needs them.

### For Developers

```bash
# Install CLI
npm install -g @clawcloud/cli

# Initialize
clawcloud init

# Purchase a VM
clawcloud vms purchase --tier small

# Deploy code
clawcloud deploy <vm-id> ./my-app

# Execute commands
clawcloud exec <vm-id> "python3 train.py"
```

## How It Works

```
AI Agent → Pays USDC → Smart Contract → VM Provisioned → Agent Deploys Code
```

1. Agent installs ClawCloud skill (one command)
2. User funds agent's wallet via Telegram bot
3. Agent autonomously purchases VMs when needed
4. Agent deploys code and scales compute
5. All without human intervention

## Features

- **Multi-Cloud Infrastructure** - GCP, AWS, and private servers
- **Flexible Wallet Management** - Auto-generated, import, export, or manage multiple
- **Customizable Compute** - Scale from 1 vCPU to 16+ vCPUs
- **Secured & Isolated** - Dedicated VMs, unique SSH keys per instance
- **No Lock-In** - Export private keys anytime, full custody

## Use Cases

**Trading Bots**  
Autonomously scale compute during high volatility, run backtests on-demand.

**Data Processing**  
Spin up VMs for ETL jobs, batch processing, parallel computing.

**Model Training**  
Acquire GPU compute for training runs, pay only for what you use.

**Web Automation**  
Get dedicated IPs and environments for scraping, monitoring, testing.

**Multi-Agent Systems**  
Agent swarms coordinate to provision distributed infrastructure.

## Repository Structure

```
clawcloud/
├── contracts/          # Smart contracts (Solidity)
├── backend/           # API & provisioning service
├── cli/               # Command-line interface
├── skill/             # OpenClaw skill (SKILL.md)
├── telegram-bot/      # Wallet management bot
├── docs/              # Documentation
└── examples/          # Example integrations
```

## Components

### Smart Contracts (`/contracts`)
- NFT-based VM access control on Base
- USDC payment processing
- Automatic provisioning triggers

### Backend API (`/backend`)
- Event listener for blockchain purchases
- Multi-cloud VM provisioning (GCP, AWS, Private)
- SSH key management
- RESTful API

### CLI (`/cli`)
- Developer-friendly VM management
- Wallet operations
- Code deployment
- Remote execution

### OpenClaw Skill (`/skill`)
- SKILL.md file for agent integration
- Teaches agents how to use ClawCloud
- Published to ClawHub registry

### Telegram Bot (`/telegram-bot`)
- Easy wallet funding
- Export/import private keys
- Multi-wallet management
- Spending notifications

## Pricing

Pay-as-you-go starting at **$0.08/hour** with fully customizable computing power.

Example configurations:
- **Small** (~1 vCPU, 1GB RAM): $0.08-0.15/hour
- **Medium** (~4 vCPU, 4GB RAM): $0.30-0.40/hour  
- **Large** (~8 vCPU, 8GB RAM): $0.60-0.80/hour
- **Custom** - Configure exactly what you need

Plus ~$0.10 blockchain transaction fee per purchase on Base L2.

## Documentation

- [Installation Guide](./docs/INSTALLATION.md)
- [API Reference](./docs/API.md)
- [Smart Contract Docs](./docs/CONTRACTS.md)

## Development

```bash
# Clone the repo
git clone https://github.com/yourusername/clawcloud.git
cd clawcloud

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your credentials

# Run tests
npm test

# Start development
npm run dev
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## Deployment

### Smart Contracts
```bash
cd contracts
npm run deploy:base-sepolia  # Testnet
npm run deploy:base          # Mainnet
```

### Backend API
```bash
cd backend
npm run build
npm start

# Or with Docker
docker-compose up -d
```

### Telegram Bot
```bash
cd telegram-bot
npm start
```

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for detailed instructions.

## Security

- ✅ Audited smart contracts (OpenZeppelin)
- ✅ Encrypted private key storage
- ✅ Non-custodial wallet system
- ✅ Isolated VM infrastructure
- ✅ Unique SSH keys per instance

Found a security issue? Please email security@clawcloud.io

## Roadmap

- [x] Smart contract deployment on Base
- [x] Multi-cloud provisioning (GCP, AWS, Private)
- [x] OpenClaw skill
- [x] Telegram bot for wallet management
- [x] CLI tool
- [ ] GPU instances
- [ ] Kubernetes clusters
- [ ] Database hosting
- [ ] Load balancers
- [ ] Agent marketplace
- [ ] Multi-chain support (Arbitrum, Optimism)

## Community

- 💬 [Telegram](https://t.me/clawcloud_devbot)
- 🐦 [Twitter](https://twitter.com/clawcloudx)
- 📖 [Documentation](https://docs.clawcloud.co)

## License

MIT License - see [LICENSE](./LICENSE) for details.

## Acknowledgments

- [OpenClaw](https://openclaw.ai) - AI agent framework
- [Base](https://base.org) - L2 blockchain
- [ClawHub](https://clawhub.com) - Skill registry
- OpenZeppelin - Smart contract libraries

---

**Built with ❤️ for the AI agent revolution**

Questions? Join our [Telegram](https://t.me/clawcloud) or open an [issue](https://github.com/yourusername/clawcloud/issues).
