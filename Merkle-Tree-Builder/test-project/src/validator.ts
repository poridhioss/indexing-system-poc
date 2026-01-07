export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

export function validatePassword(password: string): boolean {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    return password.length >= 8 &&
           /[A-Z]/.test(password) &&
           /[a-z]/.test(password) &&
           /[0-9]/.test(password);
}
// Hello world ! Fr
export function validateUsername(username: string): boolean {
    // 3-20 characters, alphanumeric and underscore only
    return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}
