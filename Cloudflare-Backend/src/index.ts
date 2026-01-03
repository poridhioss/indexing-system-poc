import {Hono} from 'hono';
import {cors} from 'hono/cors';
import { ContentfulStatusCode } from 'hono/utils/http-status';

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

// POST /v1/completions - FIM completions endpoint
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
    }, response.status as ContentfulStatusCode);
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