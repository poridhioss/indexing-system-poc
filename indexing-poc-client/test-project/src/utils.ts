/**
 * Utility functions
 */

export function formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
}

export function formatTime(date: Date): string {
    return date.toTimeString().split(' ')[0];
}

export function debounce<T extends (...args: unknown[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}

export function throttle<T extends (...args: unknown[]) => void>(
    fn: T,
    limit: number
): (...args: Parameters<T>) => void {
    let inThrottle = false;
    return (...args: Parameters<T>) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

export class Logger {
    private prefix: string;

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    log(message: string): void {
        console.log(`[${this.prefix}] ${message}`);
    }

    error(message: string): void {
        console.error(`[${this.prefix}] ERROR: ${message}`);
    }

    warn(message: string): void {
        console.warn(`[${this.prefix}] WARN: ${message}`);
    }
}
