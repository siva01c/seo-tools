#!/usr/bin/env tsx

import { mergeDomainsToIndividualJsonl } from '../src/services/fileService.js';

const storagePathArg = process.argv[2]; // optional custom storage path
const storagePath = storagePathArg ?? './storage/datasets';

console.log(`🔄 Merging daily JSONL files per domain in ${storagePath}...`);

try {
    const result = mergeDomainsToIndividualJsonl(storagePath);

    if (!result) {
        process.exit(1);
    }

    console.log('\n📋 Summary:');
    console.log(`   Domains processed: ${result.domainsProcessed}`);
    console.log(`   Source files:      ${result.filesProcessed}`);
    console.log(`   Records merged:    ${result.totalRecords}`);
    console.log('   Outputs:');
    result.outputFiles.forEach(file => console.log(`     - ${file}`));
} catch (error) {
    console.error(
        '❌ Failed to merge per-domain JSONL files:',
        error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
}
