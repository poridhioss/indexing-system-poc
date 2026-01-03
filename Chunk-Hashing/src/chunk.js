/**
 * Represents a semantic code chunk
 */
class SemanticChunk {
    constructor({
        text,
        type,
        name,
        lineStart,
        lineEnd,
        language,
        metadata = {}
    }) {
        this.text = text;
        this.type = type;           // 'function', 'class', 'method', 'block'
        this.name = name;           // Function/class name or null
        this.lineStart = lineStart; // 1-indexed
        this.lineEnd = lineEnd;     // 1-indexed
        this.language = language;
        this.metadata = metadata;   // Extra info (params, return type, etc.)
    }

    /**
     * Character count (for size limits)
     */
    get charCount() {
        return this.text.length;
    }

    /**
     * Line count
     */
    get lineCount() {
        return this.lineEnd - this.lineStart + 1;
    }

    /**
     * Create a summary string for debugging
     */
    toString() {
        return `[${this.type}] ${this.name || '(anonymous)'} (lines ${this.lineStart}-${this.lineEnd}, ${this.charCount} chars)`;
    }
}

module.exports = { SemanticChunk };