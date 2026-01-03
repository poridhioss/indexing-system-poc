# Deploy Backend on Cloudflare Workers

Cloudflare Workers is a serverless platform that runs your code at the edge, closer to your users. Unlike traditional serverless platforms that run in specific regions, Workers execute in over 300 data centers worldwide, resulting in ultra-low latency responses. This makes it an ideal choice for building real-time AI backends where every millisecond counts.

In this hands-on lab, you will create a Cloudflare Worker that proxies requests to the Codestral FIM (Fill-In-Middle) API using Hono.js, a lightweight web framework optimized for edge computing.

## Prerequisites

- A Cloudflare account (free tier is sufficient)
- Node.js 18+ installed
- A Codestral API Key from [Mistral Console](https://console.mistral.ai/codestral) (see Lab 1 for setup instructions)
- Basic knowledge of TypeScript

## Project Overview

## Architecture Overview

## What You'll Learn

By the end of this lab:

- You will understand how to create and deploy Cloudflare Workers
- You will learn how to use Hono.js for building edge APIs
- You will gain experience with Wrangler CLI for local development and deployment
- You will learn how to securely manage API keys using Cloudflare secrets
- You will practice building OpenAI-compatible API endpoints


## Project Structure

Your final project structure should look like:

```
cloudflare-backend/
├── src/
│   └── index.ts          # Main worker code
├── node_modules/
├── package.json          # Dependencies
├── package-lock.json
├── tsconfig.json         # TypeScript config
└── wrangler.toml         # Cloudflare config
```

## Lab Steps

### Step 1: Create a Cloudflare Account

If you don't already have a Cloudflare account:

1. Navigate to **https://dash.cloudflare.com/sign-up**
2. Enter your email and create a password
3. Verify your email address
4. You'll be taken to the Cloudflare dashboard


### Step 2: Install Wrangler CLI

Wrangler is Cloudflare's official CLI for managing Workers. Install it globally:

```bash
npm install -g wrangler
```

Verify the installation:

```bash
wrangler --version
```

You should see output like `wrangler 4.x.x`.

### Step 3: Authenticate Wrangler

Login to your Cloudflare account through Wrangler:

```bash
wrangler login
```

This will open a browser window. Click **Allow** to authorize Wrangler to access your Cloudflare account.


After successful authentication, you'll see a confirmation message in your terminal.

### Step 4: Create a New Worker Project

Create a new directory for your project and initialize it:

```bash
mkdir cloudflare-backend && cd cloudflare-backend
npm init -y
```

Install the required dependencies:

```bash
npm install hono
npm install -D wrangler typescript @cloudflare/workers-types
```

**Package Explanation:**

| Package | Purpose |
|---------|---------|
| `hono` | Lightweight web framework for edge computing |
| `wrangler` | Cloudflare Workers CLI for dev and deployment |
| `typescript` | TypeScript compiler |
| `@cloudflare/workers-types` | TypeScript types for Workers APIs |

### Step 5: Configure TypeScript

Create a `tsconfig.json` file:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### Step 6: Configure Wrangler

Create a `wrangler.toml` file in the project root:

```toml
name = "cloudflare-backend"
main = "src/index.ts"
compatibility_date = "2024-11-24"

# Enable Workers.dev subdomain (for testing)
workers_dev = true

# Environment variables (non-secret)
[vars]
CODESTRAL_FIM_URL = "https://codestral.mistral.ai/v1/fim/completions"
FIM_MODEL = "codestral-latest"

# Secrets (set via wrangler secret put)
# CODESTRAL_API_KEY - Your Mistral Codestral API key
```

**Configuration Explanation:**

| Field | Description |
|-------|-------------|
| `name` | Your Worker's name (used in the URL) |
| `main` | Entry point for your Worker code |
| `compatibility_date` | Workers runtime version to use |
| `workers_dev` | Enable `*.workers.dev` subdomain |
| `[vars]` | Non-secret environment variables |

### Step 7: Create the Worker Code

Create the `src` directory and the main worker file:

```bash
mkdir src
```

Create `src/index.ts` with the following code:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Environment type definition
type Env = {
  CODESTRAL_API_KEY: string;
  CODESTRAL_FIM_URL: string;
  FIM_MODEL: string;
};

// Request/Response types
interface FIMRequest {
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
}

interface FIMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    text: string;
    index: number;
    finish_reason: string;
  }>;
}

// Create Hono app with environment bindings
const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('*', cors());

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'cloudflare-backend'
  });
});

// GET /v1/models - List available models
app.get('/v1/models', (c) => {
  return c.json({
    object: 'list',
    data: [
      {
        id: 'codestral-latest',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'mistral',
      }
    ]
  });
});

// POST /v1/fim/completions - FIM completions endpoint
app.post('/v1/fim/completions', async (c) => {
  const env = c.env;

  // Validate API key is configured
  if (!env.CODESTRAL_API_KEY) {
    return c.json({
      error: {
        message: 'CODESTRAL_API_KEY not configured',
        type: 'configuration_error'
      }
    }, 500);
  }

  // Parse request body
  let request: FIMRequest;
  try {
    request = await c.req.json();
  } catch (e) {
    return c.json({
      error: {
        message: 'Invalid JSON in request body',
        type: 'invalid_request_error'
      }
    }, 400);
  }

  // Validate required fields
  if (!request.prompt && request.prompt !== '') {
    return c.json({
      error: {
        message: 'Missing required field: prompt',
        type: 'invalid_request_error'
      }
    }, 400);
  }

  console.log(`[FIM] Request - prompt: ${request.prompt.length} chars, suffix: ${request.suffix?.length || 0} chars`);

  // Call Codestral FIM API
  const startTime = Date.now();

  const response = await fetch(env.CODESTRAL_FIM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.CODESTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.FIM_MODEL,
      prompt: request.prompt,
      suffix: request.suffix || '',
      max_tokens: request.max_tokens ?? 100,
      temperature: request.temperature ?? 0.2,
    }),
  });

  const duration = Date.now() - startTime;

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[FIM] Codestral error (${duration}ms):`, errorText);
    return c.json({
      error: {
        message: `Codestral API error: ${errorText}`,
        type: 'api_error'
      }
    }, response.status);
  }

  const data = await response.json() as {
    choices?: Array<{
      text?: string;
      message?: { content?: string };
      finish_reason?: string;
    }>;
  };

  // Extract completion text (Mistral FIM returns { choices: [{ text: "..." }] })
  const completionText = data.choices?.[0]?.text ||
                         data.choices?.[0]?.message?.content || '';

  console.log(`[FIM] Response (${duration}ms) - completion: ${completionText.length} chars`);

  // Return OpenAI-compatible response
  const result: FIMResponse = {
    id: `fim-${Date.now()}`,
    object: 'text_completion',
    created: Math.floor(Date.now() / 1000),
    model: env.FIM_MODEL,
    choices: [
      {
        text: completionText,
        index: 0,
        finish_reason: data.choices?.[0]?.finish_reason || 'stop',
      }
    ],
  };

  return c.json(result);
});

// Error handling
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({
    error: {
      message: err.message || 'Internal server error',
      type: 'server_error',
    }
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: {
      message: `Route not found: ${c.req.method} ${c.req.path}`,
      type: 'not_found'
    }
  }, 404);
});

// Export the worker
export default app;
```

#### Code Explanation

**Hono Framework Setup:**

```typescript
const app = new Hono<{ Bindings: Env }>();
```

Hono is a lightweight web framework designed for edge computing. The generic parameter `{ Bindings: Env }` provides TypeScript type safety for environment variables.

**CORS Middleware:**

```typescript
app.use('*', cors());
```

Enables Cross-Origin Resource Sharing for all routes, allowing browsers to make requests from any domain.

**Health Check Endpoint:**

```typescript
app.get('/health', (c) => { ... });
```

A simple endpoint to verify the worker is running. Useful for monitoring and load balancers.

**FIM Completions Endpoint:**

```typescript
app.post('/v1/fim/completions', async (c) => { ... });
```

The main endpoint that:
1. Validates the request body
2. Calls the Codestral FIM API
3. Returns an OpenAI-compatible response

**Error Handling:**

```typescript
app.onError((err, c) => { ... });
app.notFound((c) => { ... });
```

Global error handlers for consistent error responses.

### Step 8: Add Your API Key as a Secret

Never hardcode API keys in your source code. Use Wrangler secrets instead:

```bash
wrangler secret put CODESTRAL_API_KEY
```

When prompted, paste your Codestral API key from Lab 1 and press Enter.

The secret is now securely stored and will be available to your Worker at runtime.

### Step 9: Test Locally

Start the local development server:

```bash
wrangler dev --remote
```

You should see output like:

```
 ⛅️ wrangler 4.x.x
-------------------
Starting local server...
[wrangler] Ready on http://localhost:8787
```

### Step 10: Test the Health Endpoint

Open a new terminal and test the health endpoint:

```bash
curl http://localhost:8787/health | jq
```

Expected response:

```json
{
  "status": "ok",
  "timestamp": "2024-12-31T10:00:00.000Z",
  "service": "cloudflare-backend"
}
```

### Step 11: Test the FIM Endpoint before Deployment

Test the FIM completion endpoint:

```bash
curl -X POST http://localhost:8787/v1/fim/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "def calculate_sum(a, b):\n    ",
    "suffix": "\n\nresult = calculate_sum(5, 3)\nprint(result)",
    "max_tokens": 50
  }' | jq
```

Expected response:

```json
{
  "id": "fim-1704020400000",
  "object": "text_completion",
  "created": 1704020400,
  "model": "codestral-latest",
  "choices": [
    {
      "text": "return a + b",
      "index": 0,
      "finish_reason": "stop"
    }
  ]
}
```

### Step 12: Deploy to Cloudflare

Deploy your Worker to production:

```bash
wrangler deploy
```

You should see output like:

```
 ⛅️ wrangler 4.x.x
-------------------
Total Upload: 15.23 KiB / gzip: 5.12 KiB
Uploaded cloudflare-backend (1.23 sec)
Published cloudflare-backend (0.45 sec)
  https://cloudflare-backend.YOUR_SUBDOMAIN.workers.dev
```

Copy your Worker URL - you'll need it for testing.

### Step 13: Test the Production Endpoint

Test your deployed Worker:

```bash
curl -X POST https://cloudflare-backend.fazlulkarim362.workers.dev/v1/fim/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "def calculate_sum(a, b):\n    ",
    "suffix": "\n\nresult = calculate_sum(5, 3)\nprint(result)",
    "max_tokens": 50
  }' | jq
```

Replace `YOUR_SUBDOMAIN` with your actual Cloudflare subdomain.

### Step 14: Test More Examples

Try these additional examples to verify your Worker handles different languages:

**JavaScript Function:**

```bash
curl -X POST https://cloudflare-backend.fazlulkarim362.workers.dev/v1/fim/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "function multiply(x, y) {\n    ",
    "suffix": "\n}\n\nconsole.log(multiply(4, 5));",
    "max_tokens": 50
  }' | jq
```

**Python Class:**

```bash
curl -X POST https://cloudflare-backend.fazlulkarim362.workers.dev/v1/fim/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "class User:\n    def __init__(self, name):\n        ",
    "suffix": "\n\n    def greet(self):\n        return f\"Hello, {self.name}\"",
    "max_tokens": 50
  }' | jq
```

**TypeScript Interface:**

```bash
curl -X POST https://cloudflare-backend.fazlulkarim362.workers.dev/v1/fim/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "interface User {\n    name: string;\n}\n\nfunction createUser(name: string): User {\n    ",
    "suffix": "\n}\n\nconst user = createUser(\"Alice\");",
    "max_tokens": 50
  }' | jq
```


## API Reference

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-12-31T10:00:00.000Z",
  "service": "cloudflare-backend"
}
```

### GET /v1/models

List available models.

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "codestral-latest",
      "object": "model",
      "created": 1704020400,
      "owned_by": "mistral"
    }
  ]
}
```

### POST /v1/fim/completions

Generate FIM code completion.

**Request:**
```json
{
  "prompt": "def add(a, b):\n    ",
  "suffix": "\n\nresult = add(5, 3)",
  "max_tokens": 100,
  "temperature": 0.2
}
```

**Response:**
```json
{
  "id": "fim-1704020400000",
  "object": "text_completion",
  "created": 1704020400,
  "model": "codestral-latest",
  "choices": [
    {
      "text": "return a + b",
      "index": 0,
      "finish_reason": "stop"
    }
  ]
}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Code before cursor (prefix) |
| `suffix` | string | No | `""` | Code after cursor |
| `max_tokens` | number | No | 100 | Maximum tokens to generate |
| `temperature` | number | No | 0.2 | Randomness (0.0-1.0) |

## Troubleshooting

### "CODESTRAL_API_KEY not configured"

Make sure you've added your API key as a secret:

```bash
wrangler secret put CODESTRAL_API_KEY
```

### "wrangler: command not found"

Install Wrangler globally:

```bash
npm install -g wrangler
```
### CORS errors in browser

The Worker already includes CORS middleware. If you're still getting errors, check that your request includes the correct `Content-Type` header.

## Conclusion

Congratulations! You have successfully created and deployed the backend using Cloudflare Workers and Hono.js. In this lab, you learned:

- How to create a Cloudflare Worker project with Hono.js
- How to configure TypeScript for Workers development
- How to securely manage API keys using Wrangler secrets
- How to test locally with `wrangler dev`
- How to deploy to production with `wrangler deploy`
- How to build OpenAI-compatible API endpoints

Your Worker is now live at the edge, running in 300+ data centers worldwide, ready to serve code completions with minimal latency.