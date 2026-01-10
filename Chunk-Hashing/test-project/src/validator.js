/**
 * Validation utilities
 */

const validateEmail = (email) => {
    return email.includes('@') && email.includes('.');
};

function validatePassword(password) {
    if (password.length < 8) return false;
    if (!/[A-Z]/.test(password)) return false;
    if (!/[0-9]/.test(password)) return false;
    return true;
}

export { validateEmail, validatePassword };
