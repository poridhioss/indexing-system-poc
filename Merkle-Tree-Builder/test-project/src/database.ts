export interface DatabaseConfig {
    host: string;
    port: number;
    username: string;
    password: string;
}

export class Database {
    private config: DatabaseConfig;
    private connected: boolean = false;

    constructor(config: DatabaseConfig) {
        this.config = config;
    }

    connect(): void {
        console.log(`Connecting to ${this.config.host}:${this.config.port}`);
        this.connected = true;
    }

    disconnect(): void {
        console.log('Disconnecting from database');
        this.connected = false;
    }

    query(sql: string): any[] {
        if (!this.connected) {
            throw new Error('Database not connected');
        }
        return [];
    }
}
