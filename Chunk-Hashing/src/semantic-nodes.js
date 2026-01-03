const Parser = require('web-tree-sitter');

/**
 * Semantic node types for different languages
 * These are AST node types that represent meaningful code units
 */
const SEMANTIC_NODES = {
    javascript: {
        // Top-level declarations
        function: ['function_declaration', 'generator_function_declaration'],
        class: ['class_declaration'],
        method: ['method_definition'],
        arrow: ['arrow_function'],
        variable: ['lexical_declaration', 'variable_declaration'],
        export: ['export_statement'],
    },
    typescript: {
        function: ['function_declaration', 'generator_function_declaration'],
        class: ['class_declaration'],
        method: ['method_definition'],
        arrow: ['arrow_function'],
        interface: ['interface_declaration'],
        type: ['type_alias_declaration'],
        enum: ['enum_declaration'],
        variable: ['lexical_declaration', 'variable_declaration'],
        export: ['export_statement'],
    },
    python: {
        function: ['function_definition'],
        class: ['class_definition'],
        // Python methods are function_definition inside class_definition
        decorated: ['decorated_definition'],
    },
    go: {
        function: ['function_declaration'],
        method: ['method_declaration'],
        type: ['type_declaration'],
        struct: ['struct_type'],
        interface: ['interface_type'],
    },
    rust: {
        function: ['function_item'],
        impl: ['impl_item'],
        struct: ['struct_item'],
        enum: ['enum_item'],
        trait: ['trait_item'],
        mod: ['mod_item'],
    },
};

/**
 * Get all semantic node types for a language (flattened)
 */
function getSemanticTypes(language) {
    const langNodes = SEMANTIC_NODES[language];
    if (!langNodes) return [];
    return Object.values(langNodes).flat();
}

module.exports = { SEMANTIC_NODES, getSemanticTypes };