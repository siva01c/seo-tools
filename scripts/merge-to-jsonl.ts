#!/usr/bin/env tsx

import { mergeDatasetToJsonl } from '../src/services/fileService.js';

const main = (): void => {
    console.log('🔄 Merging dataset files to JSONL format...');

    try {
        const result = mergeDatasetToJsonl();

        if (result) {
            console.log('\n📋 Summary:');
            console.log(`   Files processed: ${result.filesProcessed}`);
            console.log(`   Output file: ${result.outputFile}`);
            console.log(`   Total size: ${(result.totalSize / 1024 / 1024).toFixed(2)} MB`);
        }
    } catch (error) {
        console.error(
            '❌ Failed to merge files:',
            error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
    }
};

main();
