export class Cache<T> {
    private store: Map<string, { value: T; expires: number }>;
    private defaultTTL: number;

    constructor(defaultTTL: number = 60000) {
        this.store = new Map();
        this.defaultTTL = defaultTTL;
    }

    set(key: string, value: T, ttl?: number): void {
        const expires = Date.now() + (ttl ?? this.defaultTTL);
        this.store.set(key, { value, expires });
    }

    get(key: string): T | null {
        const entry = this.store.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expires) {
            this.store.delete(key);
            return null;
        }

        return entry.value;
    }

    has(key: string): boolean {
        return this.get(key) !== null;
    }

    delete(key: string): void {
        this.store.delete(key);
    }

    clear(): void {
        this.store.clear();
    }
}
