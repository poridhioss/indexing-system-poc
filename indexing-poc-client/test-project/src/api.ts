/**
 * API client module
 */

export interface ApiResponse<T> {
    data: T;
    status: number;
    message: string;
}

export interface ApiError {
    error: string;
    code: number;
}

export async function fetchData<T>(url: string): Promise<ApiResponse<T>> {
    const response = await fetch(url);
    const data = await response.json();
    return {
        data: data as T,
        status: response.status,
        message: 'Success',
    };
}

export async function postData<T, R>(url: string, body: T): Promise<ApiResponse<R>> {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json();
    return {
        data: data as R,
        status: response.status,
        message: 'Created',
    };
}

export class ApiClient {
    private baseUrl: string;
    private token: string | null = null;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    setToken(token: string): void {
        this.token = token;
    }

    async get<T>(endpoint: string): Promise<T> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            headers: this.getHeaders(),
        });
        return response.json();
    }

    async post<T, R>(endpoint: string, body: T): Promise<R> {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        });
        return response.json();
    }

    private getHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        if (this.token) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }
        return headers;
    }
}
