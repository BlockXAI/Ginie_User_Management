# EVI User Jobs API Documentation

This document provides comprehensive documentation for all job-related APIs in the EVI User Management backend. These APIs allow users to create, manage, view, and export their smart contract pipeline jobs.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Job Management Endpoints](#job-management-endpoints)
4. [Job Proxy Endpoints](#job-proxy-endpoints)
5. [Job Artifacts Endpoints](#job-artifacts-endpoints)
6. [Contract Verification Endpoints](#contract-verification-endpoints)
7. [Audit & Compliance Endpoints](#audit--compliance-endpoints)
8. [Error Codes](#error-codes)
9. [Frontend Integration Guide](#frontend-integration-guide)

---

## Overview

The Jobs API enables users to:
- **Create AI pipeline jobs** to generate smart contracts
- **Track job progress** in real-time via SSE streaming
- **View and manage** all their created jobs
- **Export job data** including artifacts, logs, and contract details
- **Verify deployed contracts** on blockchain explorers
- **Run security audits** and compliance checks on generated contracts

### Base URL
- **Production**: `https://usermanagementapis-production.up.railway.app`
- **Local Development**: `http://localhost:8080`

### API Prefix
All job-related endpoints use the `/u/` prefix (e.g., `/u/jobs`, `/u/proxy/job/:id`).

---

## Authentication

All job endpoints require authentication via HTTP-only cookies:

| Cookie | Purpose |
|--------|---------|
| `evium_access` | Short-lived access token (15 min) |
| `evium_refresh` | Long-lived refresh token (7 days) |
| `evium_csrf` | CSRF protection token |

**CSRF Protection**: Mutating operations (POST, PATCH, DELETE) require the `x-csrf-token` header matching the `evium_csrf` cookie.

---

## Job Management Endpoints

### 1. List User Jobs

**GET** `/u/jobs`

Returns a paginated list of all jobs created by the authenticated user.

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | No | Filter by job type (e.g., `pipeline`) |
| `state` | string | No | Filter by state (`running`, `completed`, `failed`) |
| `network` | string | No | Filter by blockchain network |
| `q` | string | No | Search query (searches prompt, filename, title) |
| `limit` | number | No | Results per page (1-100, default: 20) |
| `cursorCreatedAt` | ISO datetime | No | Pagination cursor (created_at) |
| `cursorId` | string | No | Pagination cursor (job_id) |

#### Response

```json
{
  "ok": true,
  "jobs": [
    {
      "job_id": "ai_pipeline_abc123",
      "user_id": "uuid",
      "type": "pipeline",
      "prompt": "Create an ERC20 token...",
      "filename": "MyToken.sol",
      "network": "avalanche-fuji",
      "title": "My Custom Token",
      "description": "A custom ERC20 token",
      "tags": ["erc20", "token"],
      "created_at": "2025-01-26T10:00:00Z",
      "updated_at": "2025-01-26T10:05:00Z",
      "deleted_at": null,
      "last_opened_at": "2025-01-26T10:10:00Z",
      "cache": {
        "state": "completed",
        "progress": 100,
        "address": "0x1234...",
        "fq_name": "contracts/MyToken.sol:MyToken",
        "verified": true,
        "explorer_url": "https://testnet.snowtrace.io/address/0x1234...",
        "completed_at": "2025-01-26T10:05:00Z"
      }
    }
  ],
  "nextCursor": {
    "created_at": "2025-01-26T09:00:00Z",
    "job_id": "ai_pipeline_xyz789"
  }
}
```

---

### 2. Get Job Details

**GET** `/u/jobs/:jobId`

Returns detailed information about a specific job owned by the user.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | The job ID |

#### Response

```json
{
  "ok": true,
  "job": {
    "job_id": "ai_pipeline_abc123",
    "user_id": "uuid",
    "type": "pipeline",
    "prompt": "Create an ERC20 token with name 'MyToken'...",
    "filename": "MyToken.sol",
    "network": "avalanche-fuji",
    "title": "My Custom Token",
    "description": "A custom ERC20 token for testing",
    "tags": ["erc20", "token", "test"],
    "created_at": "2025-01-26T10:00:00Z",
    "updated_at": "2025-01-26T10:05:00Z",
    "cache": {
      "state": "completed",
      "progress": 100,
      "address": "0x1234567890abcdef...",
      "fq_name": "contracts/MyToken.sol:MyToken",
      "constructor_args": [],
      "verified": true,
      "explorer_url": "https://testnet.snowtrace.io/address/0x1234...",
      "completed_at": "2025-01-26T10:05:00Z"
    }
  }
}
```

---

### 3. Update Job Metadata

**PATCH** `/u/jobs/:jobId/meta`

Update the title, description, or tags of a job.

#### Headers Required
- `x-csrf-token`: CSRF token matching the cookie

#### Request Body

```json
{
  "title": "Updated Token Name",
  "description": "Updated description for my token",
  "tags": ["erc20", "defi", "production"]
}
```

| Field | Type | Max Length | Description |
|-------|------|------------|-------------|
| `title` | string | 200 | Job title (nullable) |
| `description` | string | 2000 | Job description (nullable) |
| `tags` | string[] | 40 per tag | Array of tags (nullable) |

#### Response

```json
{
  "ok": true,
  "job": {
    "job_id": "ai_pipeline_abc123",
    "title": "Updated Token Name",
    "description": "Updated description for my token",
    "tags": ["erc20", "defi", "production"],
    ...
  }
}
```

---

### 4. Delete Job (Soft Delete)

**DELETE** `/u/jobs/:jobId`

Soft-deletes a job (sets `deleted_at` timestamp). The job can be recovered by admin if needed.

#### Headers Required
- `x-csrf-token`: CSRF token

#### Response

```json
{
  "ok": true
}
```

---

### 5. Export Job Bundle

**GET** `/u/jobs/:jobId/export`

Exports a complete bundle of job data including artifacts, logs, and deployment details.

#### Response

```json
{
  "ok": true,
  "job": { /* job record from database */ },
  "artifacts": {
    "sources": { /* Solidity source files */ },
    "abis": { /* Contract ABIs */ },
    "scripts": { /* Deployment scripts */ }
  },
  "detail": {
    "id": "ai_pipeline_abc123",
    "status": "completed",
    "result": {
      "address": "0x1234...",
      "network": "avalanche-fuji",
      "contract": "MyToken"
    }
  },
  "logs": [
    { "index": 0, "msg": "Starting pipeline...", "timestamp": "..." },
    { "index": 1, "msg": "Generating contract...", "timestamp": "..." }
  ]
}
```

---

### 6. Attach Job to User

**POST** `/u/jobs/attach`

Manually attach an existing job to the authenticated user (used internally).

#### Headers Required
- `x-csrf-token`: CSRF token

#### Request Body

```json
{
  "jobId": "ai_pipeline_abc123",
  "type": "pipeline",
  "prompt": "Create an ERC20 token...",
  "filename": "MyToken.sol",
  "network": "avalanche-fuji"
}
```

#### Response

```json
{
  "ok": true,
  "job": {
    "job_id": "ai_pipeline_abc123",
    "user_id": "uuid",
    "type": "pipeline",
    "network": "avalanche-fuji",
    "created_at": "2025-01-26T10:00:00Z"
  }
}
```

---

### 7. Update Job Cache

**POST** `/u/jobs/cache`

Updates the cached state of a job (progress, address, verification status).

#### Headers Required
- `x-csrf-token`: CSRF token

#### Request Body

```json
{
  "jobId": "ai_pipeline_abc123",
  "state": "completed",
  "progress": 100,
  "address": "0x1234567890abcdef...",
  "fq_name": "contracts/MyToken.sol:MyToken",
  "constructor_args": [],
  "verified": true,
  "explorer_url": "https://testnet.snowtrace.io/address/0x1234...",
  "completed_at": "2025-01-26T10:05:00Z"
}
```

#### Response

```json
{
  "ok": true
}
```

---

## Job Proxy Endpoints

These endpoints proxy requests to the upstream EVI AI pipeline service.

### 1. Create AI Pipeline Job

**POST** `/u/proxy/ai/pipeline`

Creates a new AI pipeline job to generate and deploy a smart contract.

#### Request Body

```json
{
  "prompt": "Create an ERC20 token named 'MyToken' with symbol 'MTK' and 1 million total supply. Include mint and burn functions.",
  "network": "avalanche-fuji",
  "maxIters": 10,
  "filename": "MyToken.sol",
  "strictArgs": true,
  "constructorArgs": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Natural language description of the contract (4-20000 chars) |
| `network` | string | Yes | Target blockchain network |
| `maxIters` | number | No | Max iteration attempts (1-50, default: 10) |
| `filename` | string | No | Output filename (max 256 chars) |
| `strictArgs` | boolean | No | Strict constructor args validation |
| `constructorArgs` | array | No | Constructor arguments for deployment |

#### Supported Networks

- `avalanche-fuji` - Avalanche Fuji Testnet
- `basecamp-testnet` - Basecamp Testnet
- `ethereum-sepolia` - Ethereum Sepolia Testnet
- `polygon-amoy` - Polygon Amoy Testnet

#### Response

```json
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_abc123"
  }
}
```

---

### 2. Get Job Detail (Proxy)

**GET** `/u/proxy/job/:id`

Gets detailed job information from the upstream pipeline service.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `includeMagical` | boolean | Include extracted "magical" insights from logs |

#### Response

```json
{
  "ok": true,
  "data": {
    "id": "ai_pipeline_abc123",
    "status": "completed",
    "progress": 100,
    "logs": [...],
    "result": {
      "address": "0x1234...",
      "network": "avalanche-fuji",
      "contract": "MyToken",
      "txHash": "0xabcd..."
    }
  },
  "magical": [
    { "type": "deployment", "address": "0x1234...", "network": "avalanche-fuji" }
  ]
}
```

---

### 3. Get Job Status (Proxy)

**GET** `/u/proxy/job/:id/status`

Gets the current status of a job.

#### Response

```json
{
  "ok": true,
  "status": "completed",
  "progress": 100
}
```

---

### 4. Get Job Logs (Polling)

**GET** `/u/proxy/job/:id/logs`

Gets job logs via polling.

#### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `afterIndex` | number | Return logs after this index |

#### Response

```json
{
  "ok": true,
  "logs": [
    { "index": 0, "msg": "Starting pipeline...", "stage": "init" },
    { "index": 1, "msg": "Generating contract...", "stage": "generate" },
    { "index": 2, "msg": "Compiling...", "stage": "compile" },
    { "index": 3, "msg": "Deploying to avalanche-fuji...", "stage": "deploy" },
    { "index": 4, "msg": "Deployed at 0x1234...", "stage": "deploy" }
  ]
}
```

---

### 5. Stream Job Logs (SSE)

**GET** `/u/proxy/job/:id/logs/stream`

Real-time streaming of job logs via Server-Sent Events (SSE).

#### Headers
- `Accept: text/event-stream`

#### SSE Events

```
event: log
data: {"index": 0, "msg": "Starting pipeline...", "stage": "init"}

event: log
data: {"index": 1, "msg": "Generating contract...", "stage": "generate"}

event: progress
data: {"progress": 50, "stage": "compile"}

event: end
data: {"status": "completed", "result": {"address": "0x1234..."}}

event: error
data: {"message": "Compilation failed", "code": "compile_error"}

event: ping
data: {"ts": 1706270400000}
```

---

## Job Artifacts Endpoints

### 1. Get All Artifacts

**GET** `/u/proxy/artifacts?jobId=:jobId`

Returns all artifacts for a job.

### 2. Get Source Files

**GET** `/u/proxy/artifacts/sources?jobId=:jobId`

Returns Solidity source files.

### 3. Get ABIs

**GET** `/u/proxy/artifacts/abis?jobId=:jobId`

Returns contract ABIs.

### 4. Get Deployment Scripts

**GET** `/u/proxy/artifacts/scripts?jobId=:jobId`

Returns Foundry deployment scripts.

### 5. Get Audit Report

**GET** `/u/proxy/artifacts/audit?jobId=:jobId`

Returns security audit artifacts.

### 6. Get Compliance Report

**GET** `/u/proxy/artifacts/compliance?jobId=:jobId`

Returns compliance check artifacts.

---

## Contract Verification Endpoints

### 1. Verify by Job

**POST** `/u/proxy/verify/byJob`

Verify a deployed contract using job artifacts.

#### Request Body

```json
{
  "jobId": "ai_pipeline_abc123",
  "network": "avalanche-fuji",
  "fullyQualifiedName": "contracts/MyToken.sol:MyToken"
}
```

#### Response

```json
{
  "ok": true,
  "verified": true,
  "explorerUrl": "https://testnet.snowtrace.io/address/0x1234..."
}
```

---

### 2. Verify by Address

**POST** `/u/proxy/verify/byAddress`

Verify a contract by its deployed address.

#### Request Body

```json
{
  "address": "0x1234567890abcdef...",
  "network": "avalanche-fuji",
  "sourceCode": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;...",
  "contractName": "MyToken",
  "constructorArgs": []
}
```

---

### 3. Check Verification Status

**GET** `/u/proxy/verify/status?address=:address&network=:network`

Check if a contract is verified.

#### Response

```json
{
  "ok": true,
  "verified": true,
  "explorerUrl": "https://testnet.snowtrace.io/address/0x1234..."
}
```

---

## Audit & Compliance Endpoints

### 1. Run Security Audit

**POST** `/u/proxy/audit/byJob`

Run a security audit on a job's generated contract.

#### Request Body

```json
{
  "jobId": "ai_pipeline_abc123",
  "model": "gpt-4",
  "policy": {}
}
```

#### Response (JSON)

```json
{
  "ok": true,
  "report": {
    "score": 85,
    "findings": [
      {
        "severity": "medium",
        "title": "Reentrancy Risk",
        "description": "...",
        "recommendation": "..."
      }
    ]
  }
}
```

#### Response (Markdown)

Set `Accept: text/markdown` header to receive formatted markdown report.

---

### 2. Run Compliance Check

**POST** `/u/proxy/compliance/byJob`

Run a compliance check on a job's contract.

#### Request Body

```json
{
  "jobId": "ai_pipeline_abc123",
  "model": "gpt-4",
  "policy": {
    "standards": ["ERC20", "OpenZeppelin"]
  }
}
```

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | Missing or invalid authentication |
| `forbidden` | 403 | CSRF token mismatch or insufficient permissions |
| `not_found` | 404 | Job not found or not owned by user |
| `bad_request` | 400 | Invalid request body or parameters |
| `rate_limited` | 429 | Too many requests |
| `unsupported_network` | 400 | Network not supported |
| `upstream_unreachable` | 502 | Cannot connect to upstream service |
| `internal_error` | 500 | Unexpected server error |

---

## Frontend Integration Guide

### Where Users Can View/Manage Jobs

In the **Evi_IDE** frontend, implement the following pages:

#### 1. Jobs Dashboard (`/jobs` or `/dashboard`)

Display all user jobs with filtering and search:

```typescript
// Fetch user jobs
const response = await fetch('/api/proxy/u/jobs?limit=20', {
  credentials: 'include'
});
const { ok, jobs, nextCursor } = await response.json();
```

**Features to implement:**
- Grid/list view of jobs
- Filter by status (running, completed, failed)
- Filter by network
- Search by prompt/title
- Pagination with cursor

#### 2. Job Detail Page (`/jobs/[jobId]`)

Show detailed job information:

```typescript
// Get job from local DB
const localJob = await fetch(`/api/proxy/u/jobs/${jobId}`);

// Get upstream details with logs
const upstream = await fetch(`/api/proxy/u/proxy/job/${jobId}?includeMagical=true`);
```

**Features to implement:**
- Job metadata (title, description, tags)
- Edit metadata inline
- Progress indicator
- Real-time log streaming
- Deployed contract address with explorer link
- Verification status
- Download/export button

#### 3. Active Job View (`/chat/[id]`)

Real-time job monitoring during creation:

```typescript
// Stream logs via SSE
const eventSource = new EventSource(`/api/proxy/u/proxy/job/${jobId}/logs/stream`);

eventSource.addEventListener('log', (e) => {
  const log = JSON.parse(e.data);
  appendLog(log.msg);
});

eventSource.addEventListener('end', (e) => {
  const result = JSON.parse(e.data);
  showDeploymentResult(result);
});
```

#### 4. Job Actions

```typescript
// Update job metadata
await fetch(`/api/proxy/u/jobs/${jobId}/meta`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken
  },
  body: JSON.stringify({ title: 'New Title', tags: ['defi'] }),
  credentials: 'include'
});

// Delete job
await fetch(`/api/proxy/u/jobs/${jobId}`, {
  method: 'DELETE',
  headers: { 'x-csrf-token': csrfToken },
  credentials: 'include'
});

// Export job bundle
const bundle = await fetch(`/api/proxy/u/jobs/${jobId}/export`);
downloadAsJson(bundle, `job-${jobId}.json`);

// Verify contract
await fetch('/api/proxy/u/proxy/verify/byJob', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken
  },
  body: JSON.stringify({ jobId, network: 'avalanche-fuji' }),
  credentials: 'include'
});
```

---

## Database Schema

### `user_jobs` Table

| Column | Type | Description |
|--------|------|-------------|
| `job_id` | TEXT PK | Pipeline job ID |
| `user_id` | UUID FK | Owner user ID |
| `type` | TEXT | Job type (default: 'pipeline') |
| `prompt` | TEXT | Original user prompt |
| `filename` | TEXT | Output filename |
| `network` | TEXT | Target network |
| `title` | TEXT | User-defined title |
| `description` | TEXT | User-defined description |
| `tags` | JSONB | Array of tags |
| `created_at` | TIMESTAMP | Creation time |
| `updated_at` | TIMESTAMP | Last update time |
| `deleted_at` | TIMESTAMP | Soft delete time |
| `last_opened_at` | TIMESTAMP | Last viewed time |

### `job_cache` Table

| Column | Type | Description |
|--------|------|-------------|
| `job_id` | TEXT PK | Pipeline job ID |
| `state` | TEXT | Current state |
| `progress` | INTEGER | Progress percentage (0-100) |
| `address` | TEXT | Deployed contract address |
| `fq_name` | TEXT | Fully qualified contract name |
| `constructor_args` | JSONB | Constructor arguments used |
| `verified` | BOOLEAN | Verification status |
| `explorer_url` | TEXT | Block explorer URL |
| `completed_at` | TIMESTAMP | Completion time |
| `updated_at` | TIMESTAMP | Cache update time |

---

## Rate Limits

| Action | Limit | Window |
|--------|-------|--------|
| Create Pipeline | 10 | 15 min |
| Read Operations | 100 | 15 min |
| Verify Contract | 10 | 15 min |

Rate limits apply both per-user and per-IP.
