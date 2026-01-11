export interface User {
    id: string;
    username: string;
    email: string;
}

export function login(username: string, password: string): User | null {
    // Simulate authentication process
    //Hello world
    if (username && password) {
        return {
            id: '1',
            username,
            email: `${username}@example.com`,
        };
    }
    return null;
}
// This is a test comment
export function logout(userId: string): void {
    console.log(`User ${userId} logged out`);
}
