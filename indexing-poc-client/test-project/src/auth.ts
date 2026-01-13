/**
 * Authentication module
 */

export interface User {
    id: string;
    username: string;
    email: string;
}

export function login(username: string, password: string): User | null {
    if (username === 'admin' && password === 'secret') {
        return {
            id: '1',
            username,
            email: 'admin@example.com',
        };
    }
    return null;
}

export function logout(userId: string): void {
    console.log(`User ${userId} logged out at ${new Date().toISOString()}`);
}

export class AuthService {
    private currentUser: User | null = null;

    authenticate(username: string, password: string): boolean {
        const user = login(username, password);
        if (user) {
            this.currentUser = user;
            return true;
        }
        return false;
    }

    getCurrentUser(): User | null {
        return this.currentUser;
    }

    signOut(): void {
        if (this.currentUser) {
            logout(this.currentUser.id);
            this.currentUser = null;
        }
    }
}
