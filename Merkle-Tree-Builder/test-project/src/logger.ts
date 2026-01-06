export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export class Logger {
    private level: LogLevel;

    constructor(level: LogLevel = LogLevel.INFO) {
        this.level = level;
    }

    debug(message: string): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.log(`[${LogLevel.DEBUG}] ${message}`);
        }
    }

    info(message: string): void {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(`[${LogLevel.INFO}] ${message}`);
        }
    }

    warn(message: string): void {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(`[${LogLevel.WARN}] ${message}`);
        }
    }

    error(message: string): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(`[${LogLevel.ERROR}] ${message}`);
        }
    }

    private shouldLog(level: LogLevel): boolean {
        const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
        return levels.indexOf(level) >= levels.indexOf(this.level);
    }
}
