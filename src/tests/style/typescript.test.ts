import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const execAsync = promisify(exec);

describe('TypeScript Code Quality Tests', () => {
    const timeout = 30000; // 30 seconds timeout

    test(
        'should compile without TypeScript errors',
        async () => {
            try {
                const { stdout, stderr } = await execAsync('npm run build');

                // Check that compilation completed successfully
                expect(stderr).toBe('');

                // Verify that dist directory was created
                const distExists = await fs.promises
                    .access('./dist')
                    .then(() => true)
                    .catch(() => false);
                expect(distExists).toBe(true);
            } catch (error: any) {
                console.error('TypeScript compilation errors:', error.stdout || error.stderr);
                throw new Error(`TypeScript compilation failed: ${error.message}`);
            }
        },
        timeout
    );

    test('should have proper TypeScript configuration', () => {
        // tsconfig.json uses `extends: "@apify/tsconfig"`, so most compiler options are inherited
        // rather than inlined — reading the file as raw JSON would miss all of them. Resolve the
        // extends chain via the TypeScript compiler API to check the *effective* configuration,
        // and use getStrictOptionValue() for the strict-mode sub-flags (noImplicitAny,
        // strictNullChecks), which TypeScript resolves implicitly from `strict: true` rather than
        // storing as literal booleans on the parsed options object.
        const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json');
        expect(configPath).toBeDefined();

        const { config, error: readError } = ts.readConfigFile(configPath!, ts.sys.readFile);
        expect(readError).toBeUndefined();

        const parsed = ts.parseJsonConfigFileContent(config, ts.sys, './');
        const options = parsed.options;

        expect(options.strict).toBe(true);
        expect(ts.getStrictOptionValue(options, 'noImplicitAny')).toBe(true);
        expect(ts.getStrictOptionValue(options, 'strictNullChecks')).toBe(true);
        expect(options.noImplicitReturns).toBe(true);
        expect(options.noUnusedParameters).toBe(true);
        // This project intentionally overrides the base config's noUnusedLocals: true to false.
        expect(options.noUnusedLocals).toBe(false);
    });

    test('should have proper import statements', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();

                // Check for import statements
                if (line.startsWith('import ') && line.includes(' from ')) {
                    // Check that imports have proper file extensions for local files
                    const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
                    if (importMatch) {
                        const importPath = importMatch[1];

                        // Local imports should have .js extension (ES modules)
                        if (importPath.startsWith('./') || importPath.startsWith('../')) {
                            if (!importPath.endsWith('.js') && !importPath.endsWith('/')) {
                                console.warn(
                                    `File ${filePath} line ${i + 1}: Local import should use .js extension: ${importPath}`
                                );
                            }
                        }
                    }
                }
            }
        }
    });

    test('should have proper export statements', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Check for mixed export styles
            const hasDefaultExport = content.includes('export default');
            const hasNamedExports = content.match(
                /export\s+(?:const|let|var|function|class|interface|type|enum)/
            );

            if (hasDefaultExport && hasNamedExports) {
                console.warn(
                    `File ${filePath}: Mixes default and named exports - consider consistency`
                );
            }
        }
    });

    test('should have proper async/await usage', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Check for unhandled promises
            const promiseWithoutAwait = content.match(
                /(?<!await\s)(?<!return\s)\w+\.\w+\([^)]*\)(?:\.\w+\([^)]*\))*(?:\s*;|\s*\n)/g
            );

            if (promiseWithoutAwait) {
                const potentialPromises = promiseWithoutAwait.filter(
                    match =>
                        match.includes('async') ||
                        match.includes('Promise') ||
                        match.includes('fetch') ||
                        match.includes('setTimeout') ||
                        match.includes('setInterval')
                );

                if (potentialPromises.length > 0) {
                    console.warn(
                        `File ${filePath}: Potential unhandled promises found: ${potentialPromises.length}`
                    );
                }
            }
        }
    });

    test('should have proper error handling', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Check for try-catch blocks
            const tryBlocks = content.match(/try\s*\{/g);
            const catchBlocks = content.match(/catch\s*\(/g);

            if (tryBlocks && catchBlocks) {
                if (tryBlocks.length !== catchBlocks.length) {
                    console.warn(`File ${filePath}: Mismatched try-catch blocks`);
                }
            }

            // Check for proper error typing
            const catchWithAny = content.match(/catch\s*\(\s*\w+\s*:\s*any\s*\)/g);
            if (catchWithAny) {
                console.warn(
                    `File ${filePath}: Found ${catchWithAny.length} catch blocks with 'any' type - consider using Error type`
                );
            }
        }
    });

    test('should have proper type definitions', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Check for function parameters without types
            const functionsWithoutTypes = content.match(
                /function\s+\w+\s*\([^)]*\w+(?!\s*:\s*\w)/g
            );

            if (functionsWithoutTypes) {
                console.warn(
                    `File ${filePath}: Found ${functionsWithoutTypes.length} function parameters without explicit types`
                );
            }

            // Check for variables without types that could be inferred
            const variablesWithoutTypes = content.match(
                /(?:const|let|var)\s+\w+\s*=\s*(?:null|undefined)(?!\s*as\s*)/g
            );

            if (variablesWithoutTypes) {
                console.warn(
                    `File ${filePath}: Found ${variablesWithoutTypes.length} variables initialized to null/undefined without explicit types`
                );
            }
        }
    });

    test('should follow consistent naming conventions', async () => {
        const tsFiles = await getTypeScriptFiles();

        for (const filePath of tsFiles) {
            const content = await fs.promises.readFile(filePath, 'utf-8');

            // Check for PascalCase classes and interfaces
            const classDeclarations = content.match(/class\s+([A-Z][a-zA-Z0-9]*)/g);
            const interfaceDeclarations = content.match(/interface\s+([A-Z][a-zA-Z0-9]*)/g);

            if (classDeclarations) {
                classDeclarations.forEach(declaration => {
                    const className = declaration.replace(/class\s+/, '');
                    if (!/^[A-Z][a-zA-Z0-9]*$/.test(className)) {
                        console.warn(
                            `File ${filePath}: Class name '${className}' should be PascalCase`
                        );
                    }
                });
            }

            if (interfaceDeclarations) {
                interfaceDeclarations.forEach(declaration => {
                    const interfaceName = declaration.replace(/interface\s+/, '');
                    if (!/^[A-Z][a-zA-Z0-9]*$/.test(interfaceName)) {
                        console.warn(
                            `File ${filePath}: Interface name '${interfaceName}' should be PascalCase`
                        );
                    }
                });
            }
        }
    });
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
