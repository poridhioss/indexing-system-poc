export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}
//
export class Logger {
    private level: LogLevel;
    private prefix: string;

    constructor(prefix: string = '', level: LogLevel = LogLevel.INFO) {
        this.prefix = prefix;
        this.level = level;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    debug(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.DEBUG) {
            console.debug(`[DEBUG]${this.prefix} ${message}`, ...args);
        }
    }

    info(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.INFO) {
            console.info(`[INFO]${this.prefix} ${message}`, ...args);
        }
    }

    warn(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.WARN) {
            console.warn(`[WARN]${this.prefix} ${message}`, ...args);
        }
    }

    error(message: string, ...args: any[]): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(`[ERROR]${this.prefix} ${message}`, ...args);
        }
    }
}

export const logger = new Logger('[App]');
