import type {
    IndexInitRequest,
    IndexInitResponse,
    IndexCheckRequest,
    IndexCheckResponse,
    IndexSyncPhase1Request,
    IndexSyncPhase1Response,
    IndexSyncPhase2Request,
    IndexSyncPhase2Response,
    HealthResponse,
    ErrorResponse,
} from './types';

/**
 * API client for the indexing worker
 * Handles HTTP communication with the Cloudflare Worker
 */
export class ApiClient {
    private baseUrl: string;
    private authToken: string;

    constructor(baseUrl: string, authToken: string) {
        // Remove trailing slash
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.authToken = authToken;
    }

    /**
     * Make an authenticated request
     */
    private async request<T>(
        endpoint: string,
        method: 'GET' | 'POST' = 'GET',
        body?: unknown
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        const headers: Record<string, string> = {
            'Authorization': `Bearer ${this.authToken}`,
        };

        if (body) {
            headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
        });

        const data = await response.json();

        if (!response.ok) {
            const error = data as ErrorResponse;
            throw new ApiError(
                error.message || 'Unknown error',
                response.status,
                error.error,
                error.details
            );
        }

        return data as T;
    }

    /**
     * GET /v1/health
     * Check if the worker is healthy
     */
    async health(): Promise<HealthResponse> {
        // Health endpoint doesn't require auth
        const url = `${this.baseUrl}/v1/health`;
        const response = await fetch(url);
        return response.json();
    }

    /**
     * POST /v1/index/init
     * First-time full indexing
     */
    async init(request: IndexInitRequest): Promise<IndexInitResponse> {
        return this.request<IndexInitResponse>('/v1/index/init', 'POST', request);
    }

    /**
     * POST /v1/index/check
     * Quick change detection
     */
    async check(request: IndexCheckRequest): Promise<IndexCheckResponse> {
        return this.request<IndexCheckResponse>('/v1/index/check', 'POST', request);
    }

    /**
     * POST /v1/index/sync (Phase 1)
     * Send hashes, get back which are needed vs cached
     */
    async syncPhase1(request: IndexSyncPhase1Request): Promise<IndexSyncPhase1Response> {
        return this.request<IndexSyncPhase1Response>('/v1/index/sync', 'POST', request);
    }

    /**
     * POST /v1/index/sync (Phase 2)
     * Send code for needed chunks
     */
    async syncPhase2(request: IndexSyncPhase2Request): Promise<IndexSyncPhase2Response> {
        return this.request<IndexSyncPhase2Response>('/v1/index/sync', 'POST', request);
    }
}

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public statusCode: number,
        public errorType: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
    }
}
