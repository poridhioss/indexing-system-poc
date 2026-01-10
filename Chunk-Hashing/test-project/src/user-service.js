/**
 * User service module
 */
import { db } from './database';

const MAX_RETRIES = 3;

async function getUser(id) {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            return await db.users.findById(id);
        } catch (err) {
            if (i === MAX_RETRIES - 1) throw err;
        }
    }
}

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
}

export { getUser, UserService };
