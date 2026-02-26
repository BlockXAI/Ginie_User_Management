
# AI Pipeline API Documentation

## Overview

This document provides comprehensive documentation for the AI-powered smart contract generation and deployment pipeline API. The API enables automated creation, compilation, and deployment of Solidity smart contracts to various blockchain networks.

**Base URL:** `https://evi-wallet-production.up.railway.app`

---

## Table of Contents

1. [Create Pipeline Job](#create-pipeline-job)
2. [Get Job Status](#get-job-status)
3. [Stream Job Logs](#stream-job-logs)
4. [Retrieve Artifacts](#retrieve-artifacts)
5. [Job Lifecycle](#job-lifecycle)
6. [Example Workflow](#example-workflow)

---

## Create Pipeline Job

Initiates a new AI pipeline job to generate and deploy a smart contract.

### Endpoint

```
POST /api/ai/pipeline
```

### Headers

- `accept: application/json`
- `Content-Type: application/json`

### Request Body

```json
{
  "prompt": "string",
  "network": "string",
  "maxIters": number,
  "contractName": "string",
  "filename": "string",
  "constructorArgs": array,
  "strictArgs": boolean,
  "context": "string"
}
```

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Detailed description of the contract to generate |
| `network` | string | Yes | Target blockchain network (e.g., "basecamp-testnet") |
| `maxIters` | number | Yes | Maximum compilation/fix iterations (max: 12) |
| `contractName` | string | Yes | Name of the contract to deploy |
| `filename` | string | Yes | Source file name (e.g., "SimpleStorage.sol") |
| `constructorArgs` | array | Yes | Constructor arguments for deployment |
| `strictArgs` | boolean | Yes | Enforce strict argument validation |
| `context` | string | No | Additional context or constraints for generation |

### Response

```json
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_<uuid>",
    "type": "ai_pipeline",
    "state": "running",
    "progress": 5,
    "createdAt": 1763901204158,
    "updatedAt": 1763901204158,
    "payload": { /* request parameters */ },
    "step": "init",
    "stepHistory": [
      { "step": "init", "t": 1763901204158 }
    ],
    "timings": { /* timing information */ },
    "result": null,
    "error": null,
    "logs": [ /* log entries */ ]
  }
}
```

### Example Request

```bash
curl -X 'POST' \
  'https://evi-wallet-production.up.railway.app/api/ai/pipeline' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
    "network": "basecamp-testnet",
    "maxIters": 5,
    "contractName": "SimpleStorage",
    "filename": "SimpleStorage.sol",
    "constructorArgs": [],
    "strictArgs": true,
    "context": "No constructor. Only the deployer should be allowed to call setValue. Use Solidity ^0.8.x."
  }'
```

---

## Get Job Status

Retrieves the current status and details of a pipeline job.

### Endpoint

```
GET /api/job/{jobId}
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Unique job identifier |

### Response

```json
{
  "id": "string",
  "type": "ai_pipeline",
  "state": "completed",
  "progress": 100,
  "createdAt": number,
  "updatedAt": number,
  "payload": { /* job configuration */ },
  "step": "deploy",
  "stepHistory": [ /* step progression */ ],
  "timings": { /* phase timings */ },
  "result": {
    "network": "string",
    "deployer": "string",
    "contract": "string",
    "fqName": "string",
    "address": "string",
    "params": { "args": [] }
  },
  "error": null,
  "logs": [ /* detailed logs */ ]
}
```

### Job States

- `running` - Job is actively processing
- `completed` - Job finished successfully
- `failed` - Job encountered an error

### Pipeline Steps

1. **init** - Initialize pipeline
2. **generate** - AI code generation
3. **write** - Write files to sandbox
4. **compile** - Compile Solidity code
5. **deploy_script** - Generate deployment script
6. **deploy** - Deploy to blockchain

### Example Request

```bash
curl -X GET \
  "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
```

---

## Stream Job Logs

Real-time streaming of job logs using Server-Sent Events (SSE).

### Endpoint

```
GET /api/job/{jobId}/logs/stream
```

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Unique job identifier |

### Event Types

#### hello
Initial connection event with job metadata.

```
event: hello
data: {"id":"ai_pipeline_xxx","lastIndex":0}
```

#### log
Individual log entry.

```
event: log
data: {"i":1,"t":1763901204158,"level":"info","msg":"Pipeline started..."}
```

#### heartbeat
Keep-alive signal.

```
event: heartbeat
data: {"ts":1763901227397,"lastIndex":18}
```

#### end
Stream completion event.

```
event: end
data: {"state":"completed"}
```

### Log Levels

- `debug` - Detailed diagnostic information
- `info` - General informational messages
- `error` - Error messages and warnings

### Example Request

```bash
curl -N "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572/logs/stream"
```

---

## Retrieve Artifacts

After job completion, retrieve generated contract artifacts.

### Get All Artifacts

```
GET /api/artifacts?jobId={jobId}
```

Returns sources, ABIs, and deployment scripts.

### Get Source Code Only

```
GET /api/artifacts/sources?jobId={jobId}
```

### Get ABIs Only

```
GET /api/artifacts/abis?jobId={jobId}
```

### Get Deployment Scripts Only

```
GET /api/artifacts/scripts?jobId={jobId}
```

### Get Audit Report

```
GET /api/artifacts/audit?jobId={jobId}
```

### Response Structure

#### All Artifacts

```json
{
  "ok": true,
  "jobId": "string",
  "scope": "string",
  "sources": [
    {
      "path": "string",
      "content": "string"
    }
  ],
  "abis": [
    {
      "path": "string",
      "name": "string",
      "abi": [ /* ABI array */ ],
      "bytecode": "string"
    }
  ],
  "scripts": [
    {
      "path": "string",
      "content": "string"
    }
  ],
  "meta": {
    "baseDir": "string"
  }
}
```

### Example Requests

```bash
# Get all artifacts
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"

# Get source code only
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/sources" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"

# Get ABIs only
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/abis" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"

# Get deployment scripts
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/scripts" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"

# Get audit report
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/audit" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
```

---

## Job Lifecycle

### Typical Timeline

A typical job follows this progression:

```
init (1ms) → generate (11-14s) → write (1ms) → compile (2-3s) → deploy_script (1ms) → deploy (5-6s)
```

**Total Duration:** ~20-25 seconds

### Phase Timings Example

```json
{
  "init": { "startedAt": 1763901204158, "endedAt": 1763901204159 },
  "generate": { "startedAt": 1763901204159, "endedAt": 1763901215340 },
  "write": { "startedAt": 1763901215341, "endedAt": 1763901215341 },
  "compile": { "startedAt": 1763901215341, "endedAt": 1763901218195 },
  "deploy_script": { "startedAt": 1763901218195, "endedAt": 1763901218195 },
  "deploy": { "startedAt": 1763901218196, "endedAt": 1763901223414 }
}
```

---

## Example Workflow

### Complete End-to-End Example

#### Step 1: Create Pipeline Job

```bash
curl -X 'POST' \
  'https://evi-wallet-production.up.railway.app/api/ai/pipeline' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Create and deploy a simple Solidity contract named SimpleStorage...",
    "network": "basecamp-testnet",
    "maxIters": 5,
    "contractName": "SimpleStorage",
    "filename": "SimpleStorage.sol",
    "constructorArgs": [],
    "strictArgs": true,
    "context": "No constructor. Only the deployer should be allowed to call setValue."
  }' | jq
```

**Response:**
```json
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
    "state": "running"
  }
}
```

#### Step 2: Monitor Progress (Optional)

```bash
curl -N "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572/logs/stream"
```

#### Step 3: Check Final Status

```bash
curl -X GET \
  "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
```

**Response:**
```json
{
  "state": "completed",
  "result": {
    "network": "basecamp-testnet",
    "deployer": "0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E",
    "contract": "SimpleStorage",
    "address": "0xA6e825f32748122b6B590AFdBf18Ebaa19378bcF"
  }
}
```

#### Step 4: Retrieve Artifacts

```bash
# Get complete source code
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/sources" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq

# Get contract ABI
curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/abis" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
```

---

## Generated Contract Example

### Source Code

```solidity
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SimpleStorage
 * @dev A simple contract to store a single uint256 value.
 */
contract SimpleStorage is Ownable {
    uint256 private _value;

    function setValue(uint256 newValue) public onlyOwner {
        _value = newValue;
    }

    function getValue() public view returns (uint256) {
        return _value;
    }
}
```

### Contract ABI

The generated contract includes the following functions:

- `setValue(uint256)` - Set stored value (owner only)
- `getValue()` - Retrieve stored value (public view)
- `owner()` - Get current owner address
- `transferOwnership(address)` - Transfer ownership
- `renounceOwnership()` - Renounce ownership

### Deployment Information

- **Network:** basecamp-testnet
- **Deployer:** 0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E
- **Contract Address:** 0xA6e825f32748122b6B590AFdBf18Ebaa19378bcF

---

## Error Handling

### Common Errors

The API may return errors at various stages:

- **Compilation Errors:** Logged with `level: "error"` during the compile phase
- **Deployment Errors:** Check the `error` field in job status
- **Network Errors:** Verify network name and connectivity

### Retry Logic

The pipeline includes automatic retry logic with up to `maxIters` attempts for compilation fixes.

---

## Notes

- Generated contracts include attribution comments from Camp-Codegen
- SPDX license warnings are informational and don't prevent deployment
- Default constructor is used unless explicitly specified
- OpenZeppelin contracts are automatically imported when needed
- All timestamps are in Unix milliseconds

---

## Contact

**Built by:** www.blockxint.com
**Contact:** mohit@blockxint.com

---

*Last Updated: November 2025*

arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -X 'POST' \
  'https://evi-wallet-production.up.railway.app/api/ai/pipeline' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
  "network": "basecamp-testnet",
  "maxIters": 5,
  "contractName": "SimpleStorage",
  "filename": "SimpleStorage.sol",
  "constructorArgs": [],
  "strictArgs": true,
  "context": "No constructor. Only the deployer should be allowed to call setValue. Use Solidity ^0.8.x."
}' | jq

  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1891  100  1223  100   668   1721    940 --:--:-- --:--:-- --:--:--  2659
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018",
    "type": "ai_pipeline",
    "state": "running",
    "progress": 5,
    "createdAt": 1763901066171,
    "updatedAt": 1763901066171,
    "payload": {
      "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
      "network": "basecamp-testnet",
      "maxIters": 5,
      "providedName": "SimpleStorage",
      "filename": "SimpleStorage.sol",
      "constructorArgs": [],
      "strictArgs": true,
      "jobKind": "pipeline"
    },
    "step": "init",
    "stepHistory": [
      {
        "step": "init",
        "t": 1763901066171
      }
    ],
    "timings": {
      "startedAt": 1763901066171,
      "endedAt": null,
      "phases": {
        "init": {
          "startedAt": 1763901066171
        }
      }
    },
    "result": null,
    "error": null,
    "logs": [
      {
        "i": 1,
        "t": 1763901066171,
        "level": "info",
        "msg": "Pipeline started. Network=basecamp-testnet, maxIters=5, file=SimpleStorage.sol, strictArgs=true"
      },
      {
        "i": 2,
        "t": 1763901066171,
        "level": "debug",
        "msg": "config: maxIters=5 (hardCap=12)"
      }
    ],
    "_logIndex": 2,
    "logsCount": 2,
    "lastLogTs": 1763901066171
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -X GET \
  "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  4566  100  4566    0     0  12067      0 --:--:-- --:--:-- --:--:-- 12079
{
  "id": "ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018",
  "type": "ai_pipeline",
  "state": "completed",
  "progress": 100,
  "createdAt": 1763901066171,
  "updatedAt": 1763901088208,
  "payload": {
    "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
    "network": "basecamp-testnet",
    "maxIters": 5,
    "providedName": "SimpleStorage",
    "filename": "SimpleStorage.sol",
    "constructorArgs": [],
    "strictArgs": true,
    "jobKind": "pipeline"
  },
  "step": "deploy",
  "stepHistory": [
    {
      "step": "init",
      "t": 1763901066171
    },
    {
      "step": "generate",
      "t": 1763901066172
    },
    {
      "step": "write",
      "t": 1763901080588
    },
    {
      "step": "compile",
      "t": 1763901080589
    },
    {
      "step": "deploy_script",
      "t": 1763901082788
    },
    {
      "step": "deploy",
      "t": 1763901082788
    }
  ],
  "timings": {
    "startedAt": 1763901066171,
    "endedAt": 1763901088208,
    "phases": {
      "init": {
        "startedAt": 1763901066171,
        "endedAt": 1763901066172
      },
      "generate": {
        "startedAt": 1763901066172,
        "endedAt": 1763901080588
      },
      "write": {
        "startedAt": 1763901080588,
        "endedAt": 1763901080589
      },
      "compile": {
        "startedAt": 1763901080589,
        "endedAt": 1763901082788
      },
      "deploy_script": {
        "startedAt": 1763901082788,
        "endedAt": 1763901082788
      },
      "deploy": {
        "startedAt": 1763901082788,
        "endedAt": 1763901088208
      }
    }
  },
  "result": {
    "network": "basecamp-testnet",
    "deployer": "0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E",
    "contract": "SimpleStorage",
    "fqName": "contracts/AI_ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018_SimpleStorage.sol:SimpleStorage",
    "address": "0xc31bBAEe74F43cc71F3b5BFEfa44F8D65169f386",
    "params": {
      "args": []
    }
  },
  "error": null,
  "logs": [
    {
      "i": 1,
      "t": 1763901066171,
      "level": "info",
      "msg": "Pipeline started. Network=basecamp-testnet, maxIters=5, file=SimpleStorage.sol, strictArgs=true"
    },
    {
      "i": 2,
      "t": 1763901066171,
      "level": "debug",
      "msg": "config: maxIters=5 (hardCap=12)"
    },
    {
      "i": 3,
      "t": 1763901066172,
      "level": "info",
      "msg": "Stage: generate -> prompt preparation"
    },
    {
      "i": 4,
      "t": 1763901066172,
      "level": "debug",
      "msg": "Enhanced prompt length=1552"
    },
    {
      "i": 5,
      "t": 1763901080588,
      "level": "debug",
      "msg": "generate_ai_response_len=924 ai_ms=14416"
    },
    {
      "i": 6,
      "t": 1763901080588,
      "level": "info",
      "msg": "Generation done in 14416ms. Code size=1028"
    },
    {
      "i": 7,
      "t": 1763901080588,
      "level": "info",
      "msg": "Stage: write -> preparing sandbox and files"
    },
    {
      "i": 8,
      "t": 1763901080589,
      "level": "info",
      "msg": "Stage: compile -> starting compile/fix loop"
    },
    {
      "i": 9,
      "t": 1763901082739,
      "level": "error",
      "msg": "Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing \"SPDX-License-Identifier: <SPDX-License>\" to each source file. Use \"SPDX-License-Identifier: UNLICENSED\" for non-open-source code. Please see https://spdx.org for more information.\n--> contracts/AI_ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018_SimpleStorage.sol\n\n\n"
    },
    {
      "i": 10,
      "t": 1763901082751,
      "level": "info",
      "msg": "Compiled 3 Solidity files successfully (evm target: paris).\n"
    },
    {
      "i": 11,
      "t": 1763901082787,
      "level": "debug",
      "msg": "iter 1/5: compile ok in 2198ms"
    },
    {
      "i": 12,
      "t": 1763901082787,
      "level": "info",
      "msg": "Compile success after 0 fix iterations."
    },
    {
      "i": 13,
      "t": 1763901082788,
      "level": "debug",
      "msg": "Artifact chosen for deploy: SimpleStorage"
    },
    {
      "i": 14,
      "t": 1763901082788,
      "level": "info",
      "msg": "Stage: deploy_script -> contract SimpleStorage"
    },
    {
      "i": 15,
      "t": 1763901082788,
      "level": "info",
      "msg": "Contract chosen for deploy: SimpleStorage"
    },
    {
      "i": 16,
      "t": 1763901082788,
      "level": "info",
      "msg": "Stage: deploy -> network basecamp-testnet"
    },
    {
      "i": 17,
      "t": 1763901088143,
      "level": "info",
      "msg": "DEPLOY_RESULT {\"network\":\"basecamp-testnet\",\"deployer\":\"0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E\",\"contract\":\"SimpleStorage\",\"fqName\":\"contracts/AI_ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018_SimpleStorage.sol:SimpleStorage\",\"address\":\"0xc31bBAEe74F43cc71F3b5BFEfa44F8D65169f386\",\"params\":{\"args\":[]}}\n"
    },
    {
      "i": 18,
      "t": 1763901088208,
      "level": "info",
      "msg": "Deploy success. Address=0xc31bBAEe74F43cc71F3b5BFEfa44F8D65169f386"
    }
  ],
  "_logIndex": 18,
  "logsCount": 18,
  "lastLogTs": 1763901088208,
  "contractName": "SimpleStorage",
  "stdout": "DEPLOY_RESULT {\"network\":\"basecamp-testnet\",\"deployer\":\"0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E\",\"contract\":\"SimpleStorage\",\"fqName\":\"contracts/AI_ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018_SimpleStorage.sol:SimpleStorage\",\"address\":\"0xc31bBAEe74F43cc71F3b5BFEfa44F8D65169f386\",\"params\":{\"args\":[]}}\n",
  "stderr": ""
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -X GET \
  "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018/status" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1807  100  1807    0     0   3643      0 --:--:-- --:--:-- --:--:--  3643
{
  "ok": true,
  "data": {
    "id": "ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018",
    "type": "ai_pipeline",
    "payload": {
      "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
      "network": "basecamp-testnet",
      "maxIters": 5,
      "providedName": "SimpleStorage",
      "filename": "SimpleStorage.sol",
      "constructorArgs": [],
      "strictArgs": true,
      "jobKind": "pipeline"
    },
    "state": "completed",
    "progress": 100,
    "step": "deploy",
    "stepHistory": [
      {
        "step": "init",
        "t": 1763901066171
      },
      {
        "step": "generate",
        "t": 1763901066172
      },
      {
        "step": "write",
        "t": 1763901080588
      },
      {
        "step": "compile",
        "t": 1763901080589
      },
      {
        "step": "deploy_script",
        "t": 1763901082788
      },
      {
        "step": "deploy",
        "t": 1763901082788
      }
    ],
    "timings": {
      "startedAt": 1763901066171,
      "endedAt": 1763901088208,
      "phases": {
        "init": {
          "startedAt": 1763901066171,
          "endedAt": 1763901066172
        },
        "generate": {
          "startedAt": 1763901066172,
          "endedAt": 1763901080588
        },
        "write": {
          "startedAt": 1763901080588,
          "endedAt": 1763901080589
        },
        "compile": {
          "startedAt": 1763901080589,
          "endedAt": 1763901082788
        },
        "deploy_script": {
          "startedAt": 1763901082788,
          "endedAt": 1763901082788
        },
        "deploy": {
          "startedAt": 1763901082788,
          "endedAt": 1763901088208
        }
      }
    },
    "result": {
      "network": "basecamp-testnet",
      "deployer": "0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E",
      "contract": "SimpleStorage",
      "fqName": "contracts/AI_ai_pipeline_1406cfdd-5b71-4af7-8bc9-a331ad1dd018_SimpleStorage.sol:SimpleStorage",
      "address": "0xc31bBAEe74F43cc71F3b5BFEfa44F8D65169f386",
      "params": {
        "args": []
      }
    },
    "error": null,
    "createdAt": 1763901066171,
    "updatedAt": 1763901088208,
    "logsCount": 18,
    "lastLogTs": 1763901088208
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -X 'POST' \
  'https://evi-wallet-production.up.railway.app/api/ai/pipeline' \
  -H 'accept: application/json' \
  -H 'Content-Type: application/json' \
  -d '{
  "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
  "network": "basecamp-testnet",
  "maxIters": 5,
  "contractName": "SimpleStorage",
  "filename": "SimpleStorage.sol",
  "constructorArgs": [],
  "strictArgs": true,
  "context": "No constructor. Only the deployer should be allowed to call setValue. Use Solidity ^0.8.x."
}' | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1891  100  1223  100   668   2523   1378 --:--:-- --:--:-- --:--:--  3898
{
  "ok": true,
  "job": {
    "id": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
    "type": "ai_pipeline",
    "state": "running",
    "progress": 5,
    "createdAt": 1763901204158,
    "updatedAt": 1763901204158,
    "payload": {
      "prompt": "Create and deploy a simple Solidity contract named SimpleStorage on the Basecamp testnet. It should: (1) store a single uint256 value, (2) expose a public function setValue(uint256 newValue) that only the deployer (owner) can call, and (3) expose a public view function getValue() that returns the stored value. Do NOT define any constructor; use the default constructor only.",
      "network": "basecamp-testnet",
      "maxIters": 5,
      "providedName": "SimpleStorage",
      "filename": "SimpleStorage.sol",
      "constructorArgs": [],
      "strictArgs": true,
      "jobKind": "pipeline"
    },
    "step": "init",
    "stepHistory": [
      {
        "step": "init",
        "t": 1763901204158
      }
    ],
    "timings": {
      "startedAt": 1763901204158,
      "endedAt": null,
      "phases": {
        "init": {
          "startedAt": 1763901204158
        }
      }
    },
    "result": null,
    "error": null,
    "logs": [
      {
        "i": 1,
        "t": 1763901204158,
        "level": "info",
        "msg": "Pipeline started. Network=basecamp-testnet, maxIters=5, file=SimpleStorage.sol, strictArgs=true"
      },
      {
        "i": 2,
        "t": 1763901204158,
        "level": "debug",
        "msg": "config: maxIters=5 (hardCap=12)"
      }
    ],
    "_logIndex": 2,
    "logsCount": 2,
    "lastLogTs": 1763901204158
  }
}

arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -N "https://evi-wallet-production.up.railway.app/api/job/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572/logs/stream"
event: hello
data: {"id":"ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572","lastIndex":0}

event: log
data: {"i":1,"t":1763901204158,"level":"info","msg":"Pipeline started. Network=basecamp-testnet, maxIters=5, file=SimpleStorage.sol, strictArgs=true"}

event: log
data: {"i":2,"t":1763901204158,"level":"debug","msg":"config: maxIters=5 (hardCap=12)"}

event: log
data: {"i":3,"t":1763901204159,"level":"info","msg":"Stage: generate -> prompt preparation"}

event: log
data: {"i":4,"t":1763901204159,"level":"debug","msg":"Enhanced prompt length=1552"}

event: log
data: {"i":5,"t":1763901215340,"level":"debug","msg":"generate_ai_response_len=989 ai_ms=11181"}

event: log
data: {"i":6,"t":1763901215341,"level":"info","msg":"Generation done in 11182ms. Code size=1093"}

event: log
data: {"i":7,"t":1763901215341,"level":"info","msg":"Stage: write -> preparing sandbox and files"}

event: log
data: {"i":8,"t":1763901215341,"level":"info","msg":"Stage: compile -> starting compile/fix loop"}

event: log
data: {"i":9,"t":1763901218141,"level":"error","msg":"Warning: SPDX license identifier not provided in source file. Before publishing, consider adding a comment containing \"SPDX-License-Identifier: <SPDX-License>\" to each source file. Use \"SPDX-License-Identifier: UNLICENSED\" for non-open-source code. Please see https://spdx.org for more information.\n--> contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol\n\n\n"}

event: log
data: {"i":10,"t":1763901218156,"level":"info","msg":"Compiled 3 Solidity files successfully (evm target: paris).\n"}

event: log
data: {"i":11,"t":1763901218195,"level":"debug","msg":"iter 1/5: compile ok in 2854ms"}

event: log
data: {"i":12,"t":1763901218195,"level":"info","msg":"Compile success after 0 fix iterations."}

event: log
data: {"i":13,"t":1763901218195,"level":"debug","msg":"Artifact chosen for deploy: SimpleStorage"}

event: log
data: {"i":14,"t":1763901218195,"level":"info","msg":"Stage: deploy_script -> contract SimpleStorage"}

event: log
data: {"i":15,"t":1763901218195,"level":"info","msg":"Contract chosen for deploy: SimpleStorage"}

event: log
data: {"i":16,"t":1763901218196,"level":"info","msg":"Stage: deploy -> network basecamp-testnet"}

event: log
data: {"i":17,"t":1763901223335,"level":"info","msg":"DEPLOY_RESULT {\"network\":\"basecamp-testnet\",\"deployer\":\"0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E\",\"contract\":\"SimpleStorage\",\"fqName\":\"contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage\",\"address\":\"0xA6e825f32748122b6B590AFdBf18Ebaa19378bcF\",\"params\":{\"args\":[]}}\n"}

event: log
data: {"i":18,"t":1763901223414,"level":"info","msg":"Deploy success. Address=0xA6e825f32748122b6B590AFdBf18Ebaa19378bcF"}

event: heartbeat
data: {"ts":1763901227397,"lastIndex":18}

event: end
data: {"state":"completed"}

arpitsingh@Arpits-MacBook-Air-2 webbuilder-main %

arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -G "https://evi-wallet-production.up.railway.app/api/artifacts" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  5102  100  5102    0     0   9479      0 --:--:-- --:--:-- --:--:--  9483
{
  "ok": true,
  "jobId": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "scope": "job:ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "sources": [
    {
      "path": "contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol",
      "content": "/**\n * This smart contract is generated by Camp-Codegen\n * Build by www.blockxint.com\n * Feel free to reach out at mohit@blockxint.com for queries\n */\npragma solidity ^0.8.20;\n\nimport \"@openzeppelin/contracts/access/Ownable.sol\";\n\n/**\n * @title SimpleStorage\n * @dev A simple contract to store a single uint256 value.\n * The contract owner (deployer) is the only one who can change the stored value.\n * Anyone can read the stored value.\n * It is designed to be deployed on the Basecamp testnet or any EVM-compatible chain.\n */\ncontract SimpleStorage is Ownable {\n    // State variable to store the value.\n    uint256 private _value;\n\n    /**\n     * @dev Sets the stored value.\n     * This function can only be called by the contract owner.\n     * @param newValue The new value to store.\n     */\n    function setValue(uint256 newValue) public onlyOwner {\n        _value = newValue;\n    }\n\n    /**\n     * @dev Gets the currently stored value.\n     * @return The uint256 value stored in the contract.\n     */\n    function getValue() public view returns (uint256) {\n        return _value;\n    }\n}\n"
    }
  ],
  "abis": [
    {
      "path": "artifacts/contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol/SimpleStorage.json",
      "name": "SimpleStorage",
      "abi": [
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "getValue",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "newValue",
              "type": "uint256"
            }
          ],
          "name": "setValue",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ],
      "bytecode": "0x608060405234801561001057600080fd5b5061001a3361001f565b61006f565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6102858061007e6000396000f3fe608060405234801561001057600080fd5b50600436106100575760003560e01c8063209652551461005c5780635524107714610072578063715018a6146100875780638da5cb5b1461008f578063f2fde38b146100aa575b600080fd5b6001546040519081526020015b60405180910390f35b610085610080366004610206565b6100bd565b005b6100856100ca565b6000546040516001600160a01b039091168152602001610069565b6100856100b836600461021f565b6100de565b6100c561015c565b600155565b6100d261015c565b6100dc60006101b6565b565b6100e661015c565b6001600160a01b0381166101505760405162461bcd60e51b815260206004820152602660248201527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160448201526564647265737360d01b60648201526084015b60405180910390fd5b610159816101b6565b50565b6000546001600160a01b031633146100dc5760405162461bcd60e51b815260206004820181905260248201527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726044820152606401610147565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b60006020828403121561021857600080fd5b5035919050565b60006020828403121561023157600080fd5b81356001600160a01b038116811461024857600080fd5b939250505056fea2646970667358221220a056e6ff8564a07028643ea903940380f0f2265bda46ddf40769632b2564fa8564736f6c63430008140033"
    }
  ],
  "scripts": [
    {
      "path": "scripts/deploy-ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572.js",
      "content": "// Auto-generated by AI pipeline for job ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572\nconst hre = require('hardhat');\n\nasync function main() {\n  const [deployer] = await hre.ethers.getSigners();\n  const Factory = await hre.ethers.getContractFactory(\"contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage\");\n  const args = [];\n  const c = await Factory.connect(deployer).deploy(...args);\n  await c.waitForDeployment();\n  const address = await c.getAddress();\n  const result = { network: hre.network.name, deployer: deployer.address, contract: \"SimpleStorage\", fqName: \"contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage\", address, params: { args } };\n  console.log('DEPLOY_RESULT ' + JSON.stringify(result));\n}\n\nmain().catch((e) => { console.error(e); process.exit(1); });\n"
    }
  ],
  "meta": {
    "baseDir": "/app/tmp/jobs/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/sources" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1465  100  1465    0     0   2695      0 --:--:-- --:--:-- --:--:--  2693
{
  "ok": true,
  "jobId": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "scope": "job:ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "sources": [
    {
      "path": "contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol",
      "content": "/**\n * This smart contract is generated by Camp-Codegen\n * Build by www.blockxint.com\n * Feel free to reach out at mohit@blockxint.com for queries\n */\npragma solidity ^0.8.20;\n\nimport \"@openzeppelin/contracts/access/Ownable.sol\";\n\n/**\n * @title SimpleStorage\n * @dev A simple contract to store a single uint256 value.\n * The contract owner (deployer) is the only one who can change the stored value.\n * Anyone can read the stored value.\n * It is designed to be deployed on the Basecamp testnet or any EVM-compatible chain.\n */\ncontract SimpleStorage is Ownable {\n    // State variable to store the value.\n    uint256 private _value;\n\n    /**\n     * @dev Sets the stored value.\n     * This function can only be called by the contract owner.\n     * @param newValue The new value to store.\n     */\n    function setValue(uint256 newValue) public onlyOwner {\n        _value = newValue;\n    }\n\n    /**\n     * @dev Gets the currently stored value.\n     * @return The uint256 value stored in the contract.\n     */\n    function getValue() public view returns (uint256) {\n        return _value;\n    }\n}\n"
    }
  ],
  "meta": {
    "baseDir": "/app/tmp/jobs/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/abis" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  2871  100  2871    0     0   7787      0 --:--:-- --:--:-- --:--:--  7801
{
  "ok": true,
  "jobId": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "scope": "job:ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "abis": [
    {
      "path": "artifacts/contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol/SimpleStorage.json",
      "name": "SimpleStorage",
      "abi": [
        {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "internalType": "address",
              "name": "previousOwner",
              "type": "address"
            },
            {
              "indexed": true,
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "OwnershipTransferred",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "getValue",
          "outputs": [
            {
              "internalType": "uint256",
              "name": "",
              "type": "uint256"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "owner",
          "outputs": [
            {
              "internalType": "address",
              "name": "",
              "type": "address"
            }
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "renounceOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "uint256",
              "name": "newValue",
              "type": "uint256"
            }
          ],
          "name": "setValue",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        },
        {
          "inputs": [
            {
              "internalType": "address",
              "name": "newOwner",
              "type": "address"
            }
          ],
          "name": "transferOwnership",
          "outputs": [],
          "stateMutability": "nonpayable",
          "type": "function"
        }
      ],
      "bytecode": "0x608060405234801561001057600080fd5b5061001a3361001f565b61006f565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b6102858061007e6000396000f3fe608060405234801561001057600080fd5b50600436106100575760003560e01c8063209652551461005c5780635524107714610072578063715018a6146100875780638da5cb5b1461008f578063f2fde38b146100aa575b600080fd5b6001546040519081526020015b60405180910390f35b610085610080366004610206565b6100bd565b005b6100856100ca565b6000546040516001600160a01b039091168152602001610069565b6100856100b836600461021f565b6100de565b6100c561015c565b600155565b6100d261015c565b6100dc60006101b6565b565b6100e661015c565b6001600160a01b0381166101505760405162461bcd60e51b815260206004820152602660248201527f4f776e61626c653a206e6577206f776e657220697320746865207a65726f206160448201526564647265737360d01b60648201526084015b60405180910390fd5b610159816101b6565b50565b6000546001600160a01b031633146100dc5760405162461bcd60e51b815260206004820181905260248201527f4f776e61626c653a2063616c6c6572206973206e6f7420746865206f776e65726044820152606401610147565b600080546001600160a01b038381166001600160a01b0319831681178455604051919092169283917f8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e09190a35050565b60006020828403121561021857600080fd5b5035919050565b60006020828403121561023157600080fd5b81356001600160a01b038116811461024857600080fd5b939250505056fea2646970667358221220a056e6ff8564a07028643ea903940380f0f2265bda46ddf40769632b2564fa8564736f6c63430008140033"
    }
  ],
  "meta": {
    "baseDir": "/app/tmp/jobs/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/scripts" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100  1200  100  1200    0     0   3582      0 --:--:-- --:--:-- --:--:--  3592
{
  "ok": true,
  "jobId": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "scope": "job:ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "scripts": [
    {
      "path": "scripts/deploy-ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572.js",
      "content": "// Auto-generated by AI pipeline for job ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572\nconst hre = require('hardhat');\n\nasync function main() {\n  const [deployer] = await hre.ethers.getSigners();\n  const Factory = await hre.ethers.getContractFactory(\"contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage\");\n  const args = [];\n  const c = await Factory.connect(deployer).deploy(...args);\n  await c.waitForDeployment();\n  const address = await c.getAddress();\n  const result = { network: hre.network.name, deployer: deployer.address, contract: \"SimpleStorage\", fqName: \"contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage\", address, params: { args } };\n  console.log('DEPLOY_RESULT ' + JSON.stringify(result));\n}\n\nmain().catch((e) => { console.error(e); process.exit(1); });\n"
    }
  ],
  "meta": {
    "baseDir": "/app/tmp/jobs/ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572"
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main % curl -G "https://evi-wallet-production.up.railway.app/api/artifacts/audit" \
  --data-urlencode "jobId=ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572" | jq
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   374  100   374    0     0   1026      0 --:--:-- --:--:-- --:--:--  1027
{
  "ok": true,
  "jobId": "ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572",
  "report": {
    "network": "basecamp-testnet",
    "deployer": "0xa58DCCb0F17279abD1d0D9069Aa8711Df4a4c58E",
    "contract": "SimpleStorage",
    "fqName": "contracts/AI_ai_pipeline_55c2002f-d41a-447f-a697-9d6d59f7a572_SimpleStorage.sol:SimpleStorage",
    "address": "0xA6e825f32748122b6B590AFdBf18Ebaa19378bcF",
    "params": {
      "args": []
    }
  }
}
arpitsingh@Arpits-MacBook-Air-2 webbuilder-main %