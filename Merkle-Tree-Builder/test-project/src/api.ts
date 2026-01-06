export interface ApiResponse<T> {
    data: T;
    status: number;
    message: string;
}

export async function fetchUser(userId: string): Promise<ApiResponse<any>> {
    // Simulate API call
    return {
        data: { id: userId, name: 'John Doe' },
        status: 200,
        message: 'Success',
    };
}

export async function createPost(title: string, content: string): Promise<ApiResponse<any>> {
    return {
        data: { id: '123', title, content },
        status: 201,
        message: 'Post created',
    };
}
