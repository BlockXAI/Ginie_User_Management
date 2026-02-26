# EVI Platform Overview

**EVI (Ethereum Virtual Intelligence)** is an AI-powered smart contract development platform that enables users to generate, deploy, verify, and manage smart contracts using natural language prompts.

---

## Table of Contents

1. [Platform Architecture](#platform-architecture)
2. [Core Features](#core-features)
3. [User Authentication System](#user-authentication-system)
4. [AI Pipeline System](#ai-pipeline-system)
5. [Job Management System](#job-management-system)
6. [Contract Verification System](#contract-verification-system)
7. [Security & Compliance](#security--compliance)
8. [Admin System](#admin-system)
9. [Premium Features & Entitlements](#premium-features--entitlements)
10. [Supported Networks](#supported-networks)
11. [API Architecture](#api-architecture)
12. [Frontend Applications](#frontend-applications)

---

## Platform Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EVI Platform                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Evi_IDE    │    │Admin Console │    │  Mobile App  │   (Frontends)    │
│  │  (Next.js)   │    │  (Next.js)   │    │   (Future)   │                   │
│  └──────┬───────┘    └──────┬───────┘    └──────────────┘                   │
│         │                   │                                                │
│         ▼                   ▼                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    User Management API (Express.js)                  │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │    │
│  │  │  Auth   │ │  User   │ │  Jobs   │ │  Proxy  │ │  Admin  │       │    │
│  │  │ Module  │ │ Module  │ │ Module  │ │ Module  │ │ Module  │       │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│         │                                      │                             │
│         ▼                                      ▼                             │
│  ┌─────────────┐  ┌─────────────┐    ┌─────────────────────────────────┐    │
│  │  PostgreSQL │  │    Redis    │    │   EVI AI Pipeline Service       │    │
│  │  (Database) │  │   (Cache)   │    │   (Contract Generation &        │    │
│  │             │  │             │    │    Deployment)                   │    │
│  └─────────────┘  └─────────────┘    └─────────────────────────────────┘    │
│                                                │                             │
│                                                ▼                             │
│                                      ┌─────────────────┐                    │
│                                      │   Blockchain    │                    │
│                                      │    Networks     │                    │
│                                      │ (Avalanche,     │                    │
│                                      │  Ethereum, etc) │                    │
│                                      └─────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Features

### 1. 🤖 AI-Powered Contract Generation

- **Natural Language Input**: Describe your smart contract in plain English
- **Intelligent Prompt Enhancement**: AI enhances your prompt for better results
- **Multiple AI Providers**: OpenAI GPT-4, Google Gemini support
- **Iterative Refinement**: Up to 50 iterations to perfect the contract

### 2. 🚀 One-Click Deployment

- **Automatic Deployment**: Contracts are deployed immediately after generation
- **Multi-Network Support**: Deploy to various testnets and mainnets
- **Constructor Args**: Support for complex constructor arguments
- **Gas Optimization**: Optimized deployment transactions

### 3. ✅ Automatic Verification

- **Block Explorer Verification**: Contracts verified on Snowtrace, Etherscan, etc.
- **Source Code Publishing**: Full source code made public
- **ABI Publication**: Contract ABIs available for integration

### 4. 🔒 Security Analysis

- **AI-Powered Audits**: Automated security vulnerability detection
- **Compliance Checks**: ERC standard compliance verification
- **Best Practice Analysis**: OpenZeppelin pattern adherence

### 5. 📊 Job Management

- **Real-Time Progress**: Live streaming of generation/deployment progress
- **Job History**: Complete history of all created contracts
- **Export Bundles**: Download complete project bundles
- **Tagging & Organization**: Organize contracts with titles, descriptions, tags

### 6. 👥 User Management

- **Passwordless Auth**: Email OTP-based authentication
- **Session Management**: Secure HTTP-only cookie sessions
- **Profile Management**: User profiles with avatars
- **Role-Based Access**: Normal users, Pro users, Admins

---

## User Authentication System

### Passwordless Email OTP Flow

```
┌────────┐     ┌─────────────┐     ┌─────────────┐     ┌────────┐
│  User  │────▶│ Send OTP    │────▶│ Email (OTP) │────▶│  User  │
│        │     │ /auth/send  │     │   Delivery  │     │ (Code) │
└────────┘     └─────────────┘     └─────────────┘     └───┬────┘
                                                           │
┌────────┐     ┌─────────────┐     ┌─────────────┐         │
│Session │◀────│ Verify OTP  │◀────│ Enter Code  │◀────────┘
│Created │     │ /auth/verify│     │             │
└────────┘     └─────────────┘     └─────────────┘
```

### Authentication Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/u/auth/send-otp` | POST | Send OTP to email |
| `/u/auth/verify` | POST | Verify OTP and create session |
| `/u/auth/refresh` | POST | Refresh access token |
| `/u/auth/logout` | POST | Revoke session |

### Session Cookies

| Cookie | Duration | Purpose |
|--------|----------|---------|
| `evium_access` | 15 minutes | Short-lived access token |
| `evium_refresh` | 7 days | Long-lived refresh token |
| `evium_csrf` | Session | CSRF protection |

### Security Features

- **CSRF Protection**: All mutating operations require CSRF token
- **Rate Limiting**: Per-user and per-IP rate limits
- **Captcha Support**: Cloudflare Turnstile integration
- **Secure Cookies**: HttpOnly, Secure, SameSite attributes

---

## AI Pipeline System

### Pipeline Stages

```
┌─────────┐    ┌──────────┐    ┌─────────┐    ┌────────┐    ┌────────┐
│  Init   │───▶│ Generate │───▶│ Compile │───▶│ Deploy │───▶│ Verify │
│         │    │          │    │         │    │        │    │        │
└─────────┘    └──────────┘    └─────────┘    └────────┘    └────────┘
     │              │               │              │             │
     ▼              ▼               ▼              ▼             ▼
   5%            25%             50%           75%          100%
```

### Stage Details

| Stage | Progress | Description |
|-------|----------|-------------|
| `init` | 0-5% | Initialize pipeline, validate inputs |
| `generate` | 5-25% | AI generates Solidity code |
| `compile` | 25-50% | Compile with Foundry/Hardhat |
| `deploy` | 50-75% | Deploy to blockchain |
| `verify` | 75-100% | Verify on block explorer |
| `completed` | 100% | Pipeline finished successfully |

### Prompt Enhancement

User prompts are automatically enhanced using AI to:
- Add explicit constructor specifications
- Include best practice requirements
- Specify security considerations
- Clarify ambiguous requirements

**Enhancement Providers:**
1. Hosted enhancement service (primary)
2. OpenAI GPT-4/GPT-4o-mini (fallback)
3. Google Gemini (fallback)

---

## Job Management System

### Job Lifecycle

```
┌──────────┐    ┌─────────┐    ┌───────────┐    ┌──────────┐
│ Created  │───▶│ Running │───▶│ Completed │───▶│ Verified │
│          │    │         │    │           │    │          │
└──────────┘    └────┬────┘    └───────────┘    └──────────┘
                     │
                     ▼
               ┌──────────┐
               │  Failed  │
               └──────────┘
```

### Job Data Model

```typescript
interface UserJob {
  job_id: string;           // Pipeline job ID
  user_id: string;          // Owner UUID
  type: 'pipeline';         // Job type
  prompt: string;           // Original user prompt
  filename: string;         // Output filename
  network: string;          // Target network
  title: string | null;     // User-defined title
  description: string | null; // User-defined description
  tags: string[];           // Organization tags
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;  // Soft delete
  last_opened_at: Date | null;
}

interface JobCache {
  job_id: string;
  state: string;            // running, completed, failed
  progress: number;         // 0-100
  address: string | null;   // Deployed contract address
  fq_name: string | null;   // Fully qualified name
  constructor_args: any[];
  verified: boolean;
  explorer_url: string | null;
  completed_at: Date | null;
}
```

### Job Operations

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Create | `POST /u/proxy/ai/pipeline` | Start new pipeline |
| List | `GET /u/jobs` | List user's jobs |
| Get | `GET /u/jobs/:id` | Get job details |
| Update | `PATCH /u/jobs/:id/meta` | Update metadata |
| Delete | `DELETE /u/jobs/:id` | Soft delete |
| Export | `GET /u/jobs/:id/export` | Export bundle |
| Stream | `GET /u/proxy/job/:id/logs/stream` | Real-time logs |

---

## Contract Verification System

### Verification Flow

```
┌─────────────┐    ┌───────────────┐    ┌──────────────┐
│ Job Complete│───▶│ Verify Request│───▶│ Block Explorer│
│ (Deployed)  │    │ /verify/byJob │    │ API (Snowtrace│
└─────────────┘    └───────────────┘    │ Etherscan)   │
                                        └──────┬───────┘
                                               │
                   ┌───────────────┐            │
                   │ Verified ✓    │◀───────────┘
                   │ Explorer URL  │
                   └───────────────┘
```

### Verification Methods

| Method | Endpoint | Use Case |
|--------|----------|----------|
| By Job | `POST /u/proxy/verify/byJob` | Verify using job artifacts |
| By Address | `POST /u/proxy/verify/byAddress` | Verify existing contract |
| Check Status | `GET /u/proxy/verify/status` | Check if verified |

---

## Security & Compliance

### Security Audit System

The platform provides AI-powered security analysis:

```json
{
  "score": 85,
  "findings": [
    {
      "severity": "high",
      "category": "reentrancy",
      "title": "Potential Reentrancy Vulnerability",
      "description": "External call before state update",
      "location": "line 45-52",
      "recommendation": "Use ReentrancyGuard modifier"
    },
    {
      "severity": "medium",
      "category": "access-control",
      "title": "Missing Access Control",
      "description": "Function accessible by anyone",
      "recommendation": "Add onlyOwner modifier"
    }
  ]
}
```

### Compliance Checking

Verify contracts comply with standards:
- ERC-20 Token Standard
- ERC-721 NFT Standard
- ERC-1155 Multi-Token Standard
- OpenZeppelin Best Practices

---

## Admin System

### Admin Capabilities

| Feature | Endpoint | Description |
|---------|----------|-------------|
| User Lookup | `GET /u/admin/user/lookup` | Search users by email/ID |
| Active Users | `GET /u/admin/users/active` | List recently active users |
| Set Entitlements | `POST /u/admin/users/entitlements` | Grant/revoke features |
| Downgrade User | `POST /u/admin/users/downgrade` | Remove pro status |
| Mint Keys | `POST /u/admin/keys/mint` | Create premium keys |
| List Keys | `GET /u/admin/keys` | View all keys |
| Revoke Key | `POST /u/admin/keys/revoke` | Revoke a key |

### Admin Console Features

The **Admin Console** (`admin.thelazyai.xyz`) provides:
- User management dashboard
- Premium key generation
- System metrics monitoring
- Audit log viewing
- Entitlement management

---

## Premium Features & Entitlements

### Entitlement Types

| Entitlement | Description |
|-------------|-------------|
| `pro_enabled` | Pro user status |
| `wallet_deployments` | Deploy via wallet signing |
| `history_export` | Export job history |
| `chat_agents` | Access to AI chat agents |
| `hosted_frontend` | Custom frontend hosting |

### Premium Keys System

Admins can mint premium keys that users redeem for Pro status:

```
Admin mints key ──▶ User receives key ──▶ User redeems ──▶ Pro enabled
```

**Key Properties:**
- One-time use
- Optional expiration date
- Tracked redemption history
- Revocable by admin

---

## Supported Networks

| Network | ID | Chain ID | Type |
|---------|-----|----------|------|
| Avalanche Fuji | `avalanche-fuji` | 43113 | Testnet |
| Ethereum Sepolia | `ethereum-sepolia` | 11155111 | Testnet |
| Polygon Amoy | `polygon-amoy` | 80002 | Testnet |
| Basecamp | `basecamp-testnet` | - | Testnet |
| Avalanche C-Chain | `avalanche` | 43114 | Mainnet |
| Ethereum | `ethereum` | 1 | Mainnet |
| Polygon | `polygon` | 137 | Mainnet |

### Network Endpoint

```
GET /u/networks
```

Returns list of enabled networks with chain IDs and explorer URLs.

---

## API Architecture

### Route Structure

All routes use `/u/` prefix to avoid conflicts with frontend `/api/` routes.

```
/u/
├── auth/
│   ├── send-otp          # Send OTP email
│   ├── verify            # Verify OTP
│   ├── refresh           # Refresh session
│   └── logout            # Logout
├── user/
│   ├── me                # Get current user
│   ├── profile           # Update profile
│   └── avatar/           # Avatar management
├── jobs/
│   ├── (list)            # List jobs
│   ├── :jobId            # Get/Delete job
│   ├── :jobId/meta       # Update metadata
│   ├── :jobId/export     # Export bundle
│   ├── attach            # Attach job to user
│   └── cache             # Update job cache
├── proxy/
│   ├── ai/pipeline       # Create pipeline
│   ├── job/:id           # Job detail
│   ├── job/:id/status    # Job status
│   ├── job/:id/logs      # Job logs
│   ├── job/:id/logs/stream # SSE logs
│   ├── artifacts/        # Get artifacts
│   ├── verify/           # Verification
│   ├── audit/            # Security audit
│   ├── compliance/       # Compliance check
│   └── wallet/           # Wallet operations
├── admin/
│   ├── users/            # User management
│   └── keys/             # Premium keys
├── networks              # List networks
├── healthz               # Health check
└── metrics               # Prometheus metrics
```

### Rate Limiting

| Category | Limit | Window |
|----------|-------|--------|
| OTP Send | 5 | 15 min |
| OTP Verify | 10 | 15 min |
| Pipeline Create | 10 | 15 min |
| Read Operations | 100 | 15 min |
| Admin Operations | 50 | 15 min |

---

## Frontend Applications

### 1. Evi_IDE (Main Application)

**URL**: `thelazyai.xyz` / `evii-v2.vercel.app`

**Features:**
- Smart contract creation wizard
- Real-time pipeline monitoring
- Job history dashboard
- Contract artifacts viewer
- Code editor with syntax highlighting
- Deployment status tracking

**Tech Stack:**
- Next.js 14 (App Router)
- React 18
- TailwindCSS
- shadcn/ui components
- TypeScript

### 2. Admin Console

**URL**: `admin.thelazyai.xyz`

**Features:**
- User management
- Premium key management
- System monitoring
- Audit logs

**Tech Stack:**
- Next.js 14
- TailwindCSS
- shadcn/ui

---

## Environment Variables

### Backend (user-api)

```env
# Database
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Authentication
SESSION_SECRET=...
OTP_PROVIDER_MODE=prod  # prod or dev

# Email (Brevo)
BREVO_API_KEY=...
EMAIL_FROM_NAME=...
EMAIL_FROM_ADDRESS=...

# AI Enhancement
OPENAI_API_KEY=...
GOOGLE_API_KEY=...
ENHANCE_PROMPT_ENABLED=1

# Upstream Services
EVI_BASE_URL=https://evi-wallet-production.up.railway.app

# CORS
APP_URL=https://thelazyai.xyz
APP_URLS=http://localhost:3000,https://evii-v2.vercel.app,...

# Security
TURNSTILE_SECRET_KEY=...  # Cloudflare Turnstile
SENTRY_DSN=...

# Admin
SEED_ADMIN_EMAILS=admin@example.com
```

### Frontend (Evi_IDE)

```env
NEXT_PUBLIC_API_BASE_URL=https://usermanagementapis-production.up.railway.app
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

---

## Monitoring & Observability

### Health Check

```
GET /u/healthz
```

Returns system health status including database and Redis connectivity.

### Metrics

```
GET /u/metrics
```

Prometheus-format metrics:
- `evi_otp_send_total` - OTP sends
- `evi_otp_verify_total` - OTP verifications
- `evi_jobs_attach_total` - Jobs attached
- `evi_keys_mint_total` - Keys minted
- `evi_keys_redeem_total` - Keys redeemed

### Error Tracking

Sentry integration for error monitoring and alerting.

### Audit Logging

All significant actions are logged:
- Authentication events
- Job operations
- Admin actions
- Verification attempts

```
GET /u/audit/logs
```

---

## Quick Start Guide

### For Users

1. **Visit** `thelazyai.xyz`
2. **Enter email** and name
3. **Verify** with OTP code
4. **Describe** your smart contract
5. **Select** target network
6. **Watch** real-time generation
7. **View** deployed contract on explorer

### For Developers

1. Clone the repository
2. Set up environment variables
3. Start PostgreSQL and Redis
4. Run `npm install && npm run dev`
5. Access API at `http://localhost:8080`

### For Admins

1. Access `admin.thelazyai.xyz`
2. Login with admin email
3. Manage users and keys
4. Monitor system health

---

## Future Roadmap

- [ ] Multi-chain deployment (deploy to multiple networks)
- [ ] Template library (pre-built contract templates)
- [ ] Collaboration (share contracts with team)
- [ ] Custom AI models (fine-tuned for specific use cases)
- [ ] Mobile application
- [ ] Mainnet deployment support
- [ ] Gas estimation and optimization
- [ ] Contract upgrade support (proxy patterns)

---

*Documentation last updated: January 2025*
