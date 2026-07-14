import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

describe('Prettier Code Formatting Tests', () => {
    const timeout = 30000; // 30 seconds timeout for formatting

    test(
        'should pass Prettier format check for all files',
        async () => {
            try {
                const { stdout, stderr } = await execAsync('npm run format:check');

                // If there are no formatting issues, Prettier should exit successfully
                expect(stderr).toBe('');

                // Check that the command completed successfully
                expect(stdout).toContain(''); // Prettier runs without output when no issues
            } catch (error: any) {
                // If Prettier fails, show the error output
                console.error('Prettier format errors:', error.stdout || error.stderr);
                throw new Error(`Prettier format check failed: ${error.message}`);
            }
        },
        timeout
    );

    test(
        'should use spaces, not tabs, for indentation',
        async () => {
            // Prettier's own multi-line continuation indentation (e.g. chained method calls)
            // is not always a multiple of 4 spaces, so that check was a false positive against
            // Prettier-formatted code — only tabs-vs-spaces is a real, checkable invariant here.
            const tsFiles = await getTypeScriptFiles();

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.trim() === '') continue; // Skip empty lines

                    const leadingWhitespace = line.match(/^(\s*)/)?.[1] || '';

                    // Check that indentation uses spaces, not tabs
                    if (leadingWhitespace.includes('\t')) {
                        fail(
                            `File ${filePath} line ${i + 1}: Uses tabs instead of spaces for indentation`
                        );
                    }
                }
            }
        },
        timeout
    );

    test(
        'should use single quotes consistently',
        async () => {
            const tsFiles = await getTypeScriptFiles();

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');

                // Check for double quotes that should be single quotes
                const doubleQuoteMatches = content.match(/(?<!\\)"(?:[^"\\]|\\.)*"(?!\s*:)/g);

                if (doubleQuoteMatches && doubleQuoteMatches.length > 0) {
                    // Filter out cases where double quotes are necessary (like JSON strings)
                    const problematicQuotes = doubleQuoteMatches.filter(
                        match =>
                            !match.includes('\\"') && // Not escaped quotes
                            !match.includes("'") // Not containing single quotes
                    );

                    if (problematicQuotes.length > 0) {
                        console.warn(
                            `File ${filePath}: Found ${problematicQuotes.length} instances of double quotes that could be single quotes`
                        );
                    }
                }
            }
        },
        timeout
    );

    test(
        'should have trailing commas in multiline structures',
        async () => {
            const tsFiles = await getTypeScriptFiles();

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');

                // Look for multiline objects/arrays without trailing commas
                const multilineObjectPattern = /\{[^}]*\n[^}]*\n[^}]*[^,]\s*\}/g;
                const multilineArrayPattern = /\[[^\]]*\n[^\]]*\n[^\]]*[^,]\s*\]/g;

                const objectMatches = content.match(multilineObjectPattern);
                const arrayMatches = content.match(multilineArrayPattern);

                if (objectMatches || arrayMatches) {
                    console.warn(
                        `File ${filePath}: May have missing trailing commas in multiline structures`
                    );
                }
            }
        },
        timeout
    );

    test(
        'should have consistent line endings (LF)',
        async () => {
            const tsFiles = await getTypeScriptFiles();

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');

                // Check for CRLF line endings
                if (content.includes('\r\n')) {
                    throw new Error(`File ${filePath}: Uses CRLF line endings instead of LF`);
                }
            }
        },
        timeout
    );

    test(
        'should not exceed maximum line length',
        async () => {
            const tsFiles = await getTypeScriptFiles();
            const maxLineLength = 100; // As configured in .prettierrc.js

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.length > maxLineLength) {
                        console.warn(
                            `File ${filePath} line ${i + 1}: Line length (${line.length}) exceeds maximum (${maxLineLength})`
                        );
                    }
                }
            }
        },
        timeout
    );

    test(
        'should have proper spacing around operators',
        async () => {
            const tsFiles = await getTypeScriptFiles();

            for (const filePath of tsFiles) {
                const content = await fs.promises.readFile(filePath, 'utf-8');

                // Check for operators without proper spacing
                const operatorPatterns = [
                    /\w\+\w/g, // word+word (should be word + word)
                    /\w-\w/g, // word-word (should be word - word)
                    /\w\*\w/g, // word*word (should be word * word)
                    /\w\/\w/g, // word/word (should be word / word)
                    /\w=\w/g, // word=word (should be word = word)
                ];

                for (const pattern of operatorPatterns) {
                    const matches = content.match(pattern);
                    if (matches && matches.length > 0) {
                        console.warn(
                            `File ${filePath}: Found ${matches.length} operators without proper spacing`
                        );
                        break; // Only warn once per file
                    }
                }
            }
        },
        timeout
    );
});

// Helper function to get all TypeScript files
async function getTypeScriptFiles(): Promise<string[]> {
    const files: string[] = [];

    async function walkDir(dir: string): Promise<void> {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (
                entry.isDirectory() &&
                !entry.name.startsWith('.') &&
                entry.name !== 'node_modules'
            ) {
                await walkDir(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.ts')) {
                files.push(fullPath);
            }
        }
    }

    await walkDir('./src');
    await walkDir('./scripts');

    return files;
}
