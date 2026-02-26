export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'EVI User Management API',
    version: '1.0.0',
    description: `
Backend API for EVI user authentication, session management, and pipeline orchestration.

## Authentication
This API uses **cookie-based sessions**. After successful OTP verification, the server sets HttpOnly cookies:
- \`evium_access\` - Short-lived access token (90 minutes)
- \`evium_refresh\` - Long-lived refresh token (30 days)
- \`evium_csrf\` - CSRF protection token (readable by JavaScript)

For write operations (POST, PUT, DELETE), include the CSRF token in the \`x-csrf-token\` header.

## Rate Limits
- OTP Send: 5 per 15 minutes per email
- OTP Verify: 10 per 15 minutes per email
- Pipeline Create: 10 per 15 minutes per user
- Wrapper Read: 600 per 15 minutes per user

## CORS
Configure allowed origins via \`APP_URLS\` environment variable (comma-separated list).
    `,
    contact: {
      name: 'EVI Support',
      email: 'support@evi.com',
    },
  },
  servers: [
    {
      url: 'https://evi-user-apis-production.up.railway.app',
      description: 'Production server',
    },
    {
      url: 'http://localhost:8080',
      description: 'Local development',
    },
  ],
  tags: [
    { name: 'Health', description: 'Health check endpoints' },
    { name: 'Networks', description: 'Supported blockchain networks' },
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'User', description: 'User profile and data' },
    { name: 'Jobs', description: 'User job management' },
    { name: 'Proxy', description: 'EVI API proxy endpoints' },
    { name: 'Wallet', description: 'Wallet-based deployment (Pro only)' },
    { name: 'Verify', description: 'Contract verification endpoints' },
    { name: 'Admin', description: 'Admin-only endpoints' },
    { name: 'Keys', description: 'Premium key management' },
  ],
  paths: {
    '/': {
      get: {
        tags: ['Health'],
        summary: 'API Info',
        description: 'Returns basic API information and available endpoints',
        responses: {
          '200': {
            description: 'API information',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'EVI User Management API' },
                    version: { type: 'string', example: '1.0.0' },
                    status: { type: 'string', example: 'running' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/u/healthz': {
      get: {
        tags: ['Health'],
        summary: 'Health Check',
        description: 'Check API health, database, and Redis connectivity',
        responses: {
          '200': {
            description: 'Health status',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    redis: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/u/networks': {
      get: {
        tags: ['Networks'],
        summary: 'List Supported Networks',
        description: 'Returns all enabled blockchain networks that can be used for smart contract deployment. This endpoint is public and does not require authentication.',
        responses: {
          '200': {
            description: 'List of supported networks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    networks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', example: 'avalanche-fuji', description: 'Network identifier to use in API requests' },
                          name: { type: 'string', example: 'Avalanche Fuji Testnet', description: 'Human-readable network name' },
                          chainId: { type: 'integer', example: 43113, description: 'EVM chain ID' },
                          blockExplorer: { type: 'string', example: 'https://testnet.snowtrace.io', description: 'Block explorer URL' },
                          testnet: { type: 'boolean', example: true, description: 'Whether this is a testnet' },
                          nativeCurrency: {
                            type: 'object',
                            properties: {
                              name: { type: 'string', example: 'AVAX' },
                              symbol: { type: 'string', example: 'AVAX' },
                              decimals: { type: 'integer', example: 18 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/u/auth/send-otp': {
      post: {
        tags: ['Auth'],
        summary: 'Send OTP',
        description: 'Send a one-time password to the specified email address',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identity'],
                properties: {
                  identity: {
                    type: 'string',
                    format: 'email',
                    description: 'Email address to send OTP to',
                    example: 'user@example.com',
                  },
                  name: {
                    type: 'string',
                    description: 'User name (for signup)',
                    example: 'John Doe',
                  },
                  mode: {
                    type: 'string',
                    enum: ['auto', 'signin', 'signup'],
                    description: 'Authentication mode',
                    default: 'auto',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'OTP sent successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    challengeId: { type: 'string', description: 'Challenge ID for verification' },
                    expiresAt: { type: 'number', description: 'Expiration timestamp' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '404': {
            description: 'User not found (signin mode only)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '409': {
            description: 'User already exists (signup mode only)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/auth/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Verify OTP',
        description: 'Verify the OTP and create a session. Sets authentication cookies on success.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['identity', 'otp'],
                properties: {
                  identity: {
                    type: 'string',
                    format: 'email',
                    example: 'user@example.com',
                  },
                  otp: {
                    type: 'string',
                    minLength: 4,
                    maxLength: 10,
                    example: '123456',
                  },
                  challengeId: {
                    type: 'string',
                    description: 'Challenge ID from send-otp response',
                  },
                  mode: {
                    type: 'string',
                    enum: ['auto', 'signin', 'signup'],
                    default: 'auto',
                  },
                  name: {
                    type: 'string',
                    description: 'Display name (for signup)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authentication successful',
            headers: {
              'Set-Cookie': {
                description: 'Session cookies (evium_access, evium_refresh, evium_csrf)',
                schema: { type: 'string' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/User' },
                    entitlements: { $ref: '#/components/schemas/Entitlements' },
                    counts: {
                      type: 'object',
                      properties: {
                        jobs_today: { type: 'integer' },
                        jobs_total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Invalid OTP',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh Session',
        description: 'Refresh the access token using the refresh cookie. Rotates both tokens.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Tokens refreshed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout',
        description: 'Revoke the current session and clear cookies',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'Logged out successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/u/user/me': {
      get: {
        tags: ['User'],
        summary: 'Get Current User',
        description: 'Get the current authenticated user profile and entitlements',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': {
            description: 'User profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/User' },
                    entitlements: { $ref: '#/components/schemas/Entitlements' },
                    counts: {
                      type: 'object',
                      properties: {
                        jobs_today: { type: 'integer' },
                        jobs_total: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/user/profile': {
      post: {
        tags: ['User'],
        summary: 'Update Profile',
        description: 'Update the current user profile',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  display_name: { type: 'string', maxLength: 80 },
                  wallet_address: { type: 'string', nullable: true },
                  profile: {
                    type: 'object',
                    properties: {
                      organization: { type: 'string' },
                      role: { type: 'string' },
                      location: { type: 'string' },
                      avatar_url: { type: 'string' },
                      bio: { type: 'string' },
                      phone: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Profile updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/User' },
                    entitlements: { $ref: '#/components/schemas/Entitlements' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/jobs': {
      get: {
        tags: ['Jobs'],
        summary: 'List Jobs',
        description: 'List jobs for the current user with pagination',
        security: [{ cookieAuth: [] }],
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', default: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'List of jobs',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    jobs: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Job' },
                    },
                    total: { type: 'integer' },
                    limit: { type: 'integer' },
                    offset: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/jobs/{jobId}': {
      get: {
        tags: ['Jobs'],
        summary: 'Get Job Details',
        description: 'Get details of a specific job (ownership verified)',
        security: [{ cookieAuth: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Job details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    job: { $ref: '#/components/schemas/Job' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Jobs'],
        summary: 'Update Job Metadata',
        description: 'Update job metadata (name, tags)',
        security: [{ cookieAuth: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Job updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['Jobs'],
        summary: 'Delete Job',
        description: 'Soft-delete a job',
        security: [{ cookieAuth: [] }],
        parameters: [
          {
            name: 'jobId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Job deleted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/proxy/artifacts': {
      get: {
        tags: ['Proxy'],
        summary: 'Get Artifacts',
        description: 'Proxy to EVI artifacts API',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Artifacts data' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/proxy/artifacts/sources': {
      get: {
        tags: ['Proxy'],
        summary: 'Get Sources',
        description: 'Proxy to EVI artifacts sources',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Source files' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/proxy/artifacts/abis': {
      get: {
        tags: ['Proxy'],
        summary: 'Get ABIs',
        description: 'Proxy to EVI artifacts ABIs',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Contract ABIs' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/proxy/artifacts/scripts': {
      get: {
        tags: ['Proxy'],
        summary: 'Get Scripts',
        description: 'Proxy to EVI artifacts scripts',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Deployment scripts' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/proxy/artifacts/audit': {
      get: {
        tags: ['Proxy'],
        summary: 'Get Audit Report',
        description: 'Proxy to EVI audit artifacts. Supports JSON or Markdown output.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'md'] } },
        ],
        responses: {
          '200': { description: 'Audit report' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/proxy/artifacts/compliance': {
      get: {
        tags: ['Proxy'],
        summary: 'Get Compliance Report',
        description: 'Proxy to EVI compliance artifacts. Supports JSON or Markdown output.',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'jobId', in: 'query', schema: { type: 'string' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['json', 'md'] } },
        ],
        responses: {
          '200': { description: 'Compliance report' },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/keys/redeem': {
      post: {
        tags: ['Keys'],
        summary: 'Redeem Premium Key',
        description: 'Redeem a premium key to upgrade account',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['key'],
                properties: {
                  key: { type: 'string', description: 'Premium key to redeem' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Key redeemed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    entitlements: { $ref: '#/components/schemas/Entitlements' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/admin/keys/mint': {
      post: {
        tags: ['Admin'],
        summary: 'Mint Premium Key',
        description: 'Generate a premium key (admin only) with optional expiry',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  expiresAt: { type: 'string', format: 'date-time', description: 'Optional expiry ISO timestamp' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Key minted',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    id: { type: 'string', format: 'uuid' },
                    key: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/u/admin/keys': {
      get: {
        tags: ['Admin'],
        summary: 'List Premium Keys',
        description: 'List all premium keys (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['minted', 'redeemed', 'revoked'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } },
        ],
        responses: {
          '200': {
            description: 'List of keys',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    keys: { type: 'array', items: { $ref: '#/components/schemas/PremiumKey' } },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/u/admin/keys/{id}': {
      get: {
        tags: ['Admin'],
        summary: 'Get Premium Key',
        description: 'Get a premium key by id (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Key', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, key: { $ref: '#/components/schemas/PremiumKey' } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/admin/keys/revoke': {
      post: {
        tags: ['Admin'],
        summary: 'Revoke Premium Key',
        description: 'Revoke a premium key (admin only)',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } } } },
        },
        responses: {
          '200': { description: 'Key revoked', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List Users',
        description: 'List all users (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          '200': {
            description: 'List of users',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    users: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                    total: { type: 'integer' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/u/admin/lookup': {
      get: {
        tags: ['Admin'],
        summary: 'Lookup User',
        description: 'Lookup user by email (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'email', in: 'query', required: true, schema: { type: 'string', format: 'email' } },
        ],
        responses: {
          '200': {
            description: 'User found',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    user: { $ref: '#/components/schemas/User' },
                    entitlements: { $ref: '#/components/schemas/Entitlements' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/admin/users/{userId}/entitlements': {
      post: {
        tags: ['Admin'],
        summary: 'Set User Entitlements',
        description: 'Update user role and entitlements (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  role: { type: 'string', enum: ['normal', 'pro', 'admin'] },
                  entitlements: { $ref: '#/components/schemas/Entitlements' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Entitlements updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/admin/users/{userId}/downgrade': {
      post: {
        tags: ['Admin'],
        summary: 'Downgrade User',
        description: 'Downgrade user to normal role (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'User downgraded',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/user/avatar': {
      post: {
        tags: ['User'],
        summary: 'Upload Avatar',
        description: 'Upload a user avatar image (png/jpeg/webp). Updates profile avatar_url on success.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'image/png': { schema: { type: 'string', format: 'binary' } },
            'image/jpeg': { schema: { type: 'string', format: 'binary' } },
            'image/webp': { schema: { type: 'string', format: 'binary' } },
          },
        },
        responses: { '200': { description: 'Avatar uploaded' }, '401': { $ref: '#/components/responses/Unauthorized' }, '415': { description: 'Unsupported media type' } },
      },
    },
    '/u/user/avatar/{id}': {
      get: {
        tags: ['User'],
        summary: 'Get Avatar Image',
        description: 'Retrieve avatar in multiple formats. Use format=json for base64 data URL (most reliable for web), format=base64 for plain data URL string, or default binary.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['binary', 'base64', 'json'], default: 'binary' }, description: 'Response format: binary (default), base64 (data URL string), json (object with data_url)' },
        ],
        responses: {
          '200': {
            description: 'Avatar data in requested format',
            content: {
              'image/*': { schema: { type: 'string', format: 'binary' }, description: 'Binary image (format=binary)' },
              'text/plain': { schema: { type: 'string' }, description: 'Data URL string (format=base64)' },
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    avatar: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        content_type: { type: 'string' },
                        size: { type: 'integer' },
                        data_url: { type: 'string', description: 'Base64 data URL for direct img src use' },
                        base64: { type: 'string', description: 'Raw base64 encoded image data' },
                      },
                    },
                  },
                },
                description: 'JSON with base64 data (format=json)',
              },
            },
          },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      delete: {
        tags: ['User'],
        summary: 'Delete Avatar',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'Deleted' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/user/avatars': {
      get: {
        tags: ['User'],
        summary: 'List User Avatars',
        description: 'List all avatars uploaded by the current user (metadata only, no bytes)',
        security: [{ cookieAuth: [] }],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }],
        responses: {
          '200': {
            description: 'List of avatars',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    avatars: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          url: { type: 'string' },
                          content_type: { type: 'string' },
                          size: { type: 'integer' },
                          created_at: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/u/user/avatar/prune': {
      post: {
        tags: ['User'],
        summary: 'Prune Avatars',
        security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { keepLatest: { type: 'integer', minimum: 1, maximum: 20, default: 3 } } } } } },
        responses: { '200': { description: 'Pruned' }, '401': { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/u/jobs/{jobId}/meta': {
      patch: {
        tags: ['Jobs'],
        summary: 'Update Job Metadata',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } } ],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string', nullable: true }, description: { type: 'string', nullable: true }, tags: { type: 'array', items: { type: 'string' }, nullable: true } } } } } },
        responses: { '200': { description: 'Job updated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/jobs/{jobId}/export': {
      get: {
        tags: ['Jobs'],
        summary: 'Export Job Bundle',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'jobId', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'Bundle' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/proxy/job/{id}': {
      get: {
        tags: ['Proxy'],
        summary: 'Job Detail (Proxy)',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'Detail' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/proxy/job/{id}/status': {
      get: {
        tags: ['Proxy'],
        summary: 'Job Status (Proxy)',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'Status' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/proxy/job/{id}/logs': {
      get: {
        tags: ['Proxy'],
        summary: 'Job Logs (Proxy)',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'Logs JSON' }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/proxy/job/{id}/logs/stream': {
      get: {
        tags: ['Proxy'],
        summary: 'Job Logs Stream (SSE)',
        description: 'Server-Sent Events stream of job logs',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'path', required: true, schema: { type: 'string' } } ],
        responses: { '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } }, '401': { $ref: '#/components/responses/Unauthorized' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/proxy/audit/byJob': {
      post: {
        tags: ['Proxy'],
        summary: 'Generate Audit (by Job)',
        security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Audit report' }, '401': { $ref: '#/components/responses/Unauthorized' }, '429': { $ref: '#/components/responses/RateLimited' } },
      },
    },
    '/u/proxy/compliance/byJob': {
      post: {
        tags: ['Proxy'],
        summary: 'Generate Compliance (by Job)',
        security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', required: ['jobId'], properties: { jobId: { type: 'string' } } } } } },
        responses: { '200': { description: 'Compliance report' }, '401': { $ref: '#/components/responses/Unauthorized' }, '429': { $ref: '#/components/responses/RateLimited' } },
      },
    },
    '/u/admin/users/active': {
      get: {
        tags: ['Admin'],
        summary: 'List Active Users',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 1000 } } ],
        responses: { '200': { description: 'List of active users' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' } },
      },
    },
    '/u/admin/user/lookup': {
      get: {
        tags: ['Admin'],
        summary: 'Lookup User',
        description: 'Lookup user by id or email (admin only)',
        security: [{ cookieAuth: [] }],
        parameters: [ { name: 'id', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'email', in: 'query', schema: { type: 'string', format: 'email' } } ],
        responses: { '200': { description: 'User found' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/admin/users/entitlements': {
      post: {
        tags: ['Admin'],
        summary: 'Set User Entitlements',
        security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' } } } } } },
        responses: { '200': { description: 'Entitlements updated' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/u/admin/users/downgrade': {
      post: {
        tags: ['Admin'],
        summary: 'Downgrade User',
        description: 'Downgrade a user to normal role by id or email (admin only)',
        security: [{ cookieAuth: [] }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' } } } } } },
        responses: { '200': { description: 'User downgraded' }, '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    // Wallet Deployment Endpoints (Pro only - requires wallet_deployments entitlement)
    '/u/proxy/wallet/networks': {
      get: {
        tags: ['Wallet'],
        summary: 'List Available Networks',
        description: 'List all available blockchain networks for wallet-based deployment. Returns network configurations including chain ID, RPC URL, and explorer. Avalanche Fuji is the default and priority network.',
        responses: {
          '200': {
            description: 'List of networks',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    default: { type: 'string', example: 'avalanche-fuji' },
                    networks: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', example: 'avalanche-fuji' },
                          name: { type: 'string', example: 'Avalanche Fuji Testnet' },
                          chainId: { type: 'integer', example: 43113 },
                          currency: { type: 'string', example: 'AVAX' },
                          explorer: { type: 'string', example: 'https://testnet.snowtrace.io' },
                          rpcUrl: { type: 'string', example: 'https://api.avax-test.network/ext/bc/C/rpc' },
                          isTestnet: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/u/proxy/wallet/deploy': {
      post: {
        tags: ['Wallet'],
        summary: 'Start Wallet Deployment',
        description: 'Start a wallet-based smart contract deployment. Requires Pro subscription with wallet_deployments entitlement. The user signs the transaction with their own wallet. Default network is avalanche-fuji.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  prompt: { type: 'string', minLength: 4, maxLength: 20000, description: 'Natural language description of the contract to deploy', example: 'Create an ERC20 token named MyToken with symbol MTK and initial supply of 1 million tokens' },
                  network: { type: 'string', default: 'avalanche-fuji', enum: ['avalanche-fuji', 'avalanche-mainnet', 'basecamp', 'basecamp-testnet', 'camp-network-testnet', 'ethereum-sepolia', 'ethereum-mainnet'], description: 'Target network for deployment (default: avalanche-fuji)' },
                  walletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'User wallet address for deployment' },
                  callbackUrl: { type: 'string', format: 'uri', description: 'URL to redirect after signing' },
                  constructorArgs: { type: 'array', items: {}, description: 'Constructor arguments for the contract' },
                  strictArgs: { type: 'boolean', description: 'Enforce strict constructor argument validation' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Deployment job created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    jobId: { type: 'string' },
                    status: { type: 'string' },
                    message: { type: 'string' },
                    checkStatusUrl: { type: 'string' },
                    networkConfig: {
                      type: 'object',
                      properties: {
                        network: { type: 'string' },
                        chainId: { type: 'integer' },
                        name: { type: 'string' },
                        explorer: { type: 'string' },
                        currency: { type: 'string' },
                        isTestnet: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/proxy/wallet/sign/{sessionId}': {
      get: {
        tags: ['Wallet'],
        summary: 'Get Signing Session',
        description: 'Get session details for signing a wallet deployment transaction. Sessions expire after 15 minutes.',
        security: [{ cookieAuth: [] }],
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', pattern: '^sess_[\\w-]+$' }, description: 'Session ID from the magic link' }],
        responses: {
          '200': { description: 'Session details', content: { 'application/json': { schema: { type: 'object', properties: { sessionId: { type: 'string' }, jobId: { type: 'string' }, contractName: { type: 'string' }, network: { type: 'string' }, estimatedGas: { type: 'string' }, unsignedTx: { type: 'object' }, chainId: { type: 'integer' }, expiresAt: { type: 'integer' }, status: { type: 'string' } } } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/proxy/wallet/sign/{sessionId}/submit': {
      post: {
        tags: ['Wallet'],
        summary: 'Submit Signed Transaction',
        description: 'Submit a signed transaction hash after the user has signed with their wallet.',
        security: [{ cookieAuth: [] }],
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', pattern: '^sess_[\\w-]+$' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['txHash', 'walletAddress'],
                properties: {
                  txHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$', description: 'Transaction hash from the signed transaction' },
                  walletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Wallet address that signed the transaction' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Transaction submitted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, jobId: { type: 'string' }, txHash: { type: 'string' }, message: { type: 'string' } } } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/u/proxy/wallet/sessions/stats': {
      get: {
        tags: ['Wallet'],
        summary: 'Get Session Statistics',
        description: 'Get statistics about wallet deployment sessions for monitoring.',
        security: [{ cookieAuth: [] }],
        responses: {
          '200': { description: 'Session statistics', content: { 'application/json': { schema: { type: 'object', properties: { total: { type: 'integer' }, active: { type: 'integer' }, signed: { type: 'integer' }, expired: { type: 'integer' } } } } } },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    // Contract Verification Endpoints
    '/u/proxy/verify/byAddress': {
      post: {
        tags: ['Verify'],
        summary: 'Verify Contract by Address',
        description: 'Verify a deployed contract by address using repository contracts. Uses Hardhat with Blockscout customChains.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['address'],
                properties: {
                  address: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$', description: 'Contract address to verify' },
                  network: { type: 'string', default: 'basecamp', description: 'Network where contract is deployed' },
                  fullyQualifiedName: { type: 'string', description: 'Fully qualified contract name (e.g., contracts/File.sol:Contract)' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Verification result' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/proxy/verify/byJob': {
      post: {
        tags: ['Verify'],
        summary: 'Verify Contract by Job',
        description: 'Verify a deployed contract using artifacts from a previous deployment job.',
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['jobId'],
                properties: {
                  jobId: { type: 'string', minLength: 6, description: 'Job ID from a previous deployment' },
                  network: { type: 'string', default: 'basecamp', description: 'Network where contract is deployed' },
                  fullyQualifiedName: { type: 'string', description: 'Fully qualified contract name' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Verification result' },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/NotFound' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
    '/u/proxy/verify/status': {
      get: {
        tags: ['Verify'],
        summary: 'Check Verification Status',
        description: 'Check if a contract address is verified on the block explorer (Blockscout or Etherscan).',
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: 'address', in: 'query', required: true, schema: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, description: 'Contract address to check' },
          { name: 'network', in: 'query', schema: { type: 'string', default: 'basecamp' }, description: 'Network where contract is deployed' },
        ],
        responses: {
          '200': { description: 'Verification status', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, verified: { type: 'boolean' }, explorerUrl: { type: 'string' } } } } } },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '429': { $ref: '#/components/responses/RateLimited' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'evium_access',
        description: 'Session cookie set after successful authentication',
      },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['normal', 'pro', 'admin'] },
          display_name: { type: 'string', nullable: true },
          wallet_address: { type: 'string', nullable: true },
          profile: {
            type: 'object',
            properties: {
              organization: { type: 'string' },
              role: { type: 'string' },
              location: { type: 'string' },
              avatar_url: { type: 'string' },
              bio: { type: 'string' },
            },
          },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Entitlements: {
        type: 'object',
        properties: {
          pro_enabled: { type: 'boolean' },
          wallet_deployments: { type: 'boolean' },
          history_export: { type: 'boolean' },
          chat_agents: { type: 'boolean' },
          hosted_frontend: { type: 'boolean' },
          daily_job_limit: { type: 'integer' },
        },
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          job_id: { type: 'string' },
          status: { type: 'string' },
          name: { type: 'string', nullable: true },
          tags: { type: 'array', items: { type: 'string' } },
          created_at: { type: 'string', format: 'date-time' },
          cached_response: { type: 'object', nullable: true },
        },
      },
      PremiumKey: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          tier: { type: 'string', enum: ['pro', 'enterprise'] },
          status: { type: 'string', enum: ['active', 'redeemed', 'revoked'] },
          note: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          redeemed_at: { type: 'string', format: 'date-time', nullable: true },
          redeemed_by: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      Error: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { ok: false, error: { code: 'bad_request' } },
          },
        },
      },
      Unauthorized: {
        description: 'Unauthorized - missing or invalid session',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { ok: false, error: { code: 'unauthorized' } },
          },
        },
      },
      Forbidden: {
        description: 'Forbidden - insufficient permissions',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { ok: false, error: { code: 'forbidden' } },
          },
        },
      },
      NotFound: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { ok: false, error: { code: 'not_found' } },
          },
        },
      },
      RateLimited: {
        description: 'Rate limit exceeded',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { ok: false, error: { code: 'rate_limited' } },
          },
        },
      },
    },
  },
};
