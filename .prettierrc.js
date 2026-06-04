export default {
    // Print width - line length that prettier will wrap on
    printWidth: 100,

    // Tab width - number of spaces per indentation level
    tabWidth: 4,

    // Use tabs instead of spaces
    useTabs: false,

    // Semicolons - add semicolons at the end of statements
    semi: true,

    // Quotes - use single quotes instead of double quotes
    singleQuote: true,

    // Quote props - only add quotes around object properties when necessary
    quoteProps: 'as-needed',

    // JSX quotes - use single quotes in JSX
    jsxSingleQuote: true,

    // Trailing commas - add trailing commas where valid in ES5 (objects, arrays, etc.)
    trailingComma: 'es5',

    // Bracket spacing - add spaces between brackets in object literals
    bracketSpacing: true,

    // Bracket line - put > on the same line instead of new line
    bracketSameLine: false,

    // Arrow function parentheses - avoid parentheses when possible
    arrowParens: 'avoid',

    // Range - format the entire file
    rangeStart: 0,
    rangeEnd: Infinity,

    // Parser - let prettier determine the parser automatically
    // parser: undefined,

    // Filepath - specify the input filepath
    // filepath: undefined,

    // Require pragma - only format files that have a pragma comment
    requirePragma: false,

    // Insert pragma - insert a pragma comment to the top of files
    insertPragma: false,

    // Prose wrap - wrap prose if it exceeds the print width
    proseWrap: 'preserve',

    // HTML whitespace sensitivity
    htmlWhitespaceSensitivity: 'css',

    // Vue files script and style tags indentation
    vueIndentScriptAndStyle: false,

    // End of line - use LF (Unix) line endings
    endOfLine: 'lf',

    // Embedded language formatting
    embeddedLanguageFormatting: 'auto',

    // Single attribute per line in HTML, Vue, JSX
    singleAttributePerLine: false,

    // Override settings for specific file types
    overrides: [
        {
            files: '*.json',
            options: {
                tabWidth: 2,
                parser: 'json',
            },
        },
        {
            files: '*.yml',
            options: {
                tabWidth: 2,
                parser: 'yaml',
            },
        },
        {
            files: '*.yaml',
            options: {
                tabWidth: 2,
                parser: 'yaml',
            },
        },
        {
            files: '*.md',
            options: {
                tabWidth: 2,
                parser: 'markdown',
                proseWrap: 'always',
            },
        },
    ],
};
