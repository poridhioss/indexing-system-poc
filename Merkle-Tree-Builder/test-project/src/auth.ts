export interface User {
    id: string;
    username: string;
    email: string;
}

export function login(username: string, password: string): User | null {
    // Simulate authentication
    if (username && password) {
        return {
            id: '1',
            username,
            email: `${username}@example.com`,
        };
    }
    return null;
}

export function logout(userId: string): void {
    console.log(`User ${userId} logged out`);
}
