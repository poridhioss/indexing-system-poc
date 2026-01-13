import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ProjectConfig } from './types';

/**
 * Manages project configuration stored in .puku/project.json
 */
export class ProjectConfigManager {
    private projectRoot: string;
    private pukuDir: string;
    private configPath: string;

    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.pukuDir = path.join(this.projectRoot, '.puku');
        this.configPath = path.join(this.pukuDir, 'project.json');
    }

    /**
     * Check if this is a new project (no .puku/project.json exists)
     */
    isNewProject(): boolean {
        return !fs.existsSync(this.configPath);
    }

    /**
     * Load existing project config
     */
    loadConfig(): ProjectConfig | null {
        try {
            if (!fs.existsSync(this.configPath)) {
                return null;
            }
            const data = fs.readFileSync(this.configPath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Failed to load project config:', err);
            return null;
        }
    }

    /**
     * Create new project config with generated UUID
     */
    createConfig(): ProjectConfig {
        // Ensure .puku directory exists
        if (!fs.existsSync(this.pukuDir)) {
            fs.mkdirSync(this.pukuDir, { recursive: true });
        }

        const config: ProjectConfig = {
            projectId: this.generateUUID(),
            createdAt: new Date().toISOString(),
        };

        this.saveConfig(config);
        return config;
    }

    /**
     * Save project config
     */
    saveConfig(config: ProjectConfig): void {
        if (!fs.existsSync(this.pukuDir)) {
            fs.mkdirSync(this.pukuDir, { recursive: true });
        }
        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
    }

    /**
     * Get or create project config
     */
    getOrCreateConfig(): ProjectConfig {
        const existing = this.loadConfig();
        if (existing) {
            return existing;
        }
        return this.createConfig();
    }

    /**
     * Generate UUID v4
     */
    private generateUUID(): string {
        return crypto.randomUUID();
    }

    /**
     * Get the .puku directory path
     */
    getPukuDir(): string {
        return this.pukuDir;
    }
}
