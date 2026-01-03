const { SemanticChunker } = require('./chunker');
const path = require('path');

async function main() {
    // Initialize chunker with language grammars
    const chunker = new SemanticChunker({
        maxChunkSize: 4000,
        minChunkSize: 50,
    });

    await chunker.initialize({
        javascript: require.resolve('tree-sitter-javascript/tree-sitter-javascript.wasm'),
        python: require.resolve('tree-sitter-python/tree-sitter-python.wasm'),
    });

    // Sample JavaScript code
    const jsCode = `
/**
 * User management module
 */
import { db } from './database';

const MAX_RETRIES = 3;

/**
 * Fetch a user by ID
 * @param {string} id - User ID
 * @returns {Promise<User>}
 */
async function getUser(id) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === MAX_RETRIES - 1) throw err;
        }
    }
}

/**
 * User service class
 */
class UserService {
    constructor(database) {
        this.db = database;
    }

    async create(userData) {
        const user = new User(userData);
        await this.db.users.insert(user);
        return user;
    }

    async update(id, changes) {
        return await this.db.users.update(id, changes);
    }

    async delete(id) {
        return await this.db.users.remove(id);
    }
}

// Helper function
const validateEmail = (email) => {
    return email.includes('@') && email.includes('.');
};

export { getUser, UserService, validateEmail };
    `.trim();

    console.log('=== JavaScript Chunks ===\n');
    const jsChunks = chunker.chunk(jsCode, 'javascript');

    jsChunks.forEach((chunk, i) => {
        console.log(`--- Chunk ${i + 1} ---`);
        console.log(`Type: ${chunk.type}`);
        console.log(`Name: ${chunk.name || '(none)'}`);
        console.log(`Lines: ${chunk.lineStart}-${chunk.lineEnd} (${chunk.lineCount} lines)`);
        console.log(`Size: ${chunk.charCount} characters`);
        if (Object.keys(chunk.metadata).length > 0) {
            console.log(`Metadata:`, chunk.metadata);
        }
        console.log(`Preview: ${chunk.text.split('\n')[0].substring(0, 60)}...`);
        console.log();
    });

    // Sample Python code
    const pyCode = `
"""
User authentication module
"""
from typing import Optional
from hashlib import sha256

class AuthenticationError(Exception):
    """Raised when authentication fails."""
    pass

def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return sha256(password.encode()).hexdigest()

def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    return hash_password(password) == hashed

class Authenticator:
    """Handles user authentication."""

    def __init__(self, user_store):
        self.users = user_store

    def login(self, username: str, password: str) -> Optional[str]:
        """Attempt to log in a user."""
        user = self.users.get(username)
        if not user:
            raise AuthenticationError("User not found")

        if not verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid password")

        return self._generate_token(user)

    def _generate_token(self, user) -> str:
        """Generate an authentication token."""
        import secrets
        return secrets.token_urlsafe(32)
    `.trim();

    console.log('\n=== Python Chunks ===\n');
    const pyChunks = chunker.chunk(pyCode, 'python');

    pyChunks.forEach((chunk, i) => {
        console.log(`--- Chunk ${i + 1} ---`);
        console.log(`Type: ${chunk.type}`);
        console.log(`Name: ${chunk.name || '(none)'}`);
        console.log(`Lines: ${chunk.lineStart}-${chunk.lineEnd}`);
        console.log(`Size: ${chunk.charCount} characters`);
        console.log(`Preview: ${chunk.text.split('\n')[0].substring(0, 60)}...`);
        console.log();
    });
}

main().catch(console.error);