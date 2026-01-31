# ClawCloud Backend

This directory contains the ClawCloud backend infrastructure.

## What It Does

- Listens for VM purchases on Base blockchain
- Provisions VMs on cloud providers
- Manages SSH credentials
- Serves REST API

## Implementation

Backend implementation is proprietary. For integration:

1. Deploy the smart contract (public in `/contracts`)
2. Implement your own provisioning logic
3. Or contact us for licensing: team@clawcloud.io

## API Documentation

See `/docs/API.md` for endpoint specifications.

## Requirements

- Node.js 18+
- Cloud provider account (GCP/AWS)
- Base RPC endpoint
- Treasury wallet

## Architecture

[Show high-level diagram only, no code]
