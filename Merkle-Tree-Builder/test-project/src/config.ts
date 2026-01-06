export interface AppConfig {
    apiUrl: string;
    timeout: number;
    debug: boolean;
}

export const config: AppConfig = {
    apiUrl: 'https://api.example.com',
    timeout: 5000,
    debug: process.env.NODE_ENV === 'development',
};

export function getConfig(): AppConfig {
    return config;
}

export function updateConfig(updates: Partial<AppConfig>): void {
    Object.assign(config, updates);
}
