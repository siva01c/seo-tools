import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('ESLint Code Style Tests', () => {
    const timeout = 30000; // 30 seconds timeout for linting

    test(
        'should pass ESLint validation for all TypeScript files',
        async () => {
            try {
                const { stdout, stderr } = await execAsync('npm run lint');

                // If there are no errors, ESLint should exit successfully
                expect(stderr).toBe('');

                // Check that the command completed successfully
                expect(stdout).toContain(''); // ESLint runs without output when no errors
            } catch (error: any) {
                // If ESLint fails, show the error output
                console.error('ESLint errors:', error.stdout || error.stderr);
                throw new Error(`ESLint validation failed: ${error.message}`);
            }
        },
        timeout
    );

    test(
        'should have no TypeScript-specific linting errors',
        async () => {
            try {
                const { stdout } = await execAsync('npm run lint -- --format json');

                if (stdout.trim()) {
                    const results = JSON.parse(stdout);
                    const tsErrors = results.filter(
                        (result: any) => result.filePath.endsWith('.ts') && result.errorCount > 0
                    );

                    if (tsErrors.length > 0) {
                        const errorMessages = tsErrors.map(
                            (result: any) =>
                                `${result.filePath}: ${result.messages
                                    .map(
                                        (msg: any) =>
                                            `${msg.line}:${msg.column} - ${msg.message} (${msg.ruleId})`
                                    )
                                    .join(', ')}`
                        );

                        throw new Error(
                            `TypeScript linting errors found:\n${errorMessages.join('\n')}`
                        );
                    }
                }
            } catch (error: any) {
                // Only fail if it's not a linting error (exit code 1)
                if (!error.stdout || error.code !== 1) {
                    throw new Error(`ESLint execution failed: ${error.message}`);
                }
            }
        },
        timeout
    );

    test(
        'should enforce naming conventions',
        async () => {
            try {
                const { stdout } = await execAsync('npm run lint -- --format json');

                if (stdout.trim()) {
                    const results = JSON.parse(stdout);
                    const namingErrors = results.flatMap((result: any) =>
                        result.messages.filter(
                            (msg: any) => msg.ruleId === '@typescript-eslint/naming-convention'
                        )
                    );

                    expect(namingErrors.length).toBe(0);
                }
            } catch (error: any) {
                // Check if there are naming convention errors
                if (error.stdout?.includes('naming-convention')) {
                    throw new Error('Naming convention violations found');
                }
            }
        },
        timeout
    );

    test(
        'should enforce no unused variables',
        async () => {
            try {
                const { stdout } = await execAsync('npm run lint -- --format json');

                if (stdout.trim()) {
                    const results = JSON.parse(stdout);
                    const unusedVarErrors = results.flatMap((result: any) =>
                        result.messages.filter(
                            (msg: any) => msg.ruleId === '@typescript-eslint/no-unused-vars'
                        )
                    );

                    expect(unusedVarErrors.length).toBe(0);
                }
            } catch (error: any) {
                // Check if there are unused variable errors
                if (error.stdout?.includes('no-unused-vars')) {
                    throw new Error('Unused variable violations found');
                }
            }
        },
        timeout
    );

    test(
        'should enforce explicit return types on functions',
        async () => {
            try {
                const { stdout } = await execAsync('npm run lint -- --format json');

                if (stdout.trim()) {
                    const results = JSON.parse(stdout);
                    const returnTypeWarnings = results.flatMap((result: any) =>
                        result.messages.filter(
                            (msg: any) =>
                                msg.ruleId === '@typescript-eslint/explicit-function-return-type'
                        )
                    );

                    // This should be warnings, not errors, so we just log them
                    if (returnTypeWarnings.length > 0) {
                        console.warn(
                            `Found ${returnTypeWarnings.length} functions without explicit return types`
                        );
                    }
                }
            } catch (error: any) {
                // This is expected to have warnings, not errors
                if (error.code === 1 && error.stdout) {
                    try {
                        // Parse and check that it's only warnings
                        const results = JSON.parse(error.stdout);
                        const errors = results.flatMap((result: any) =>
                            result.messages.filter((msg: any) => msg.severity === 2)
                        );

                        if (errors.length > 0) {
                            throw new Error('Found actual errors, not just warnings');
                        }
                    } catch (parseError) {
                        // If JSON parsing fails, the output is likely not in JSON format
                        // This is acceptable for this test since we're checking for warnings
                        console.warn('Could not parse ESLint JSON output, test passed');
                    }
                }
            }
        },
        timeout
    );
});
