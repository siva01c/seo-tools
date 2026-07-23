import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export const mergeDatasetToJsonl = (
    storagePath = './storage/datasets',
    outputFile = './storage/all-domains-merged.jsonl'
):
    | { filesProcessed: number; domainsProcessed: number; outputFile: string; totalSize: number }
    | undefined => {
    try {
        if (!existsSync(storagePath)) {
            console.error(`Storage directory not found: ${storagePath}`);
            return;
        }

        let mergedContent = '';
        let totalJsonlFiles = 0;
        let totalDomains = 0;

        // Get all domain directories
        const domainDirs = readdirSync(storagePath)
            .filter(item => {
                const itemPath = join(storagePath, item);
                return statSync(itemPath).isDirectory();
            })
            .sort();

        console.log(`Found ${domainDirs.length} domain directories to process`);

        for (const domainDir of domainDirs) {
            const domainPath = join(storagePath, domainDir);

            // Get all date folders within the domain
            const dateFolders = readdirSync(domainPath)
                .filter(item => {
                    const itemPath = join(domainPath, item);
                    return statSync(itemPath).isDirectory();
                })
                .sort();

            let domainJsonlCount = 0;

            for (const dateFolder of dateFolders) {
                const dateFolderPath = join(domainPath, dateFolder);

                // Look for domain-specific JSONL file (domain_name.jsonl)
                const domainFilename = domainDir.replace(/\./g, '_');
                const jsonlFile = join(dateFolderPath, `${domainFilename}.jsonl`);

                if (existsSync(jsonlFile)) {
                    console.log(`📁 Processing ${domainDir}/${dateFolder}/${domainFilename}.jsonl`);

                    try {
                        const content = readFileSync(jsonlFile, 'utf8');

                        // Add domain and date metadata to each line
                        const lines = content
                            .trim()
                            .split('\n')
                            .filter(line => line.trim());

                        for (const line of lines) {
                            if (line.trim()) {
                                try {
                                    const jsonData = JSON.parse(line);
                                    jsonData._metadata = {
                                        domain: domainDir,
                                        crawlDate: dateFolder,
                                        sourceFile: `${domainDir}/${dateFolder}/${domainFilename}.jsonl`,
                                    };
                                    mergedContent += JSON.stringify(jsonData) + '\n';
                                } catch (parseError) {
                                    console.warn(
                                        `   ⚠️  Error parsing line in ${jsonlFile}:`,
                                        parseError
                                    );
                                }
                            }
                        }

                        domainJsonlCount++;
                        totalJsonlFiles++;
                        console.log(`   ✅ Processed: ${lines.length} records from ${jsonlFile}`);
                    } catch (error) {
                        console.warn(
                            `   ⚠️  Error processing file ${jsonlFile}:`,
                            error instanceof Error ? error.message : 'Unknown error'
                        );
                    }
                } else {
                    console.log(`⚠️  No JSONL file found at ${jsonlFile}`);
                }
            }

            if (domainJsonlCount > 0) {
                console.log(`📊 ${domainDir}: ${domainJsonlCount} JSONL files merged`);
                totalDomains++;
            }
        }

        if (totalJsonlFiles === 0) {
            console.log('❌ No JSONL files found to merge');
            return;
        }

        // Write the merged JSONL file
        writeFileSync(outputFile, mergedContent);

        console.log(
            `\n✅ Successfully merged ${totalJsonlFiles} JSONL files from ${totalDomains} domains into ${outputFile}`
        );
        console.log(`📊 Total size: ${(mergedContent.length / 1024 / 1024).toFixed(2)} MB`);

        return {
            filesProcessed: totalJsonlFiles,
            domainsProcessed: totalDomains,
            outputFile,
            totalSize: mergedContent.length,
        };
    } catch (error) {
        console.error('Error merging dataset files:', error);
        throw error;
    }
};

export const mergeSingleDomain = (
    storagePath = './storage/datasets',
    domain: string
): { filesProcessed: number; totalRecords: number; outputPath: string } | undefined => {
    try {
        const domainPath = join(storagePath, domain);
        if (!existsSync(domainPath)) {
            console.error(`Domain directory not found: ${domainPath}`);
            return;
        }

        const domainFilename = `${domain.replace(/\./g, '_')}.jsonl`;
        const outputPath = join(domainPath, domainFilename);

        const dateFolders = readdirSync(domainPath)
            .filter(item => statSync(join(domainPath, item)).isDirectory())
            .sort();

        const mergedLines: string[] = [];
        let filesProcessed = 0;
        let totalRecords = 0;

        for (const dateFolder of dateFolders) {
            const sourceFile = join(domainPath, dateFolder, domainFilename);

            if (!existsSync(sourceFile)) continue;

            const content = readFileSync(sourceFile, 'utf8')
                .split('\n')
                .filter(line => line.trim());

            if (content.length === 0) continue;

            const annotated = content.map(line => {
                try {
                    const obj = JSON.parse(line);
                    obj._metadata = {
                        domain,
                        crawlDate: dateFolder,
                        sourceFile: sourceFile,
                    };
                    return JSON.stringify(obj);
                } catch {
                    return line;
                }
            });
            mergedLines.push(...annotated);
            filesProcessed++;
            totalRecords += content.length;
        }

        if (mergedLines.length === 0) {
            return undefined;
        }

        writeFileSync(outputPath, mergedLines.join('\n') + '\n');
        return { filesProcessed, totalRecords, outputPath };
    } catch (error) {
        console.error(
            `Error merging domain ${domain}:`,
            error instanceof Error ? error.message : String(error)
        );
        return undefined;
    }
};

export const mergeDomainsToIndividualJsonl = (
    storagePath = './storage/datasets'
):
    | {
          domainsProcessed: number;
          filesProcessed: number;
          outputFiles: string[];
          totalRecords: number;
      }
    | undefined => {
    try {
        if (!existsSync(storagePath)) {
            console.error(`Storage directory not found: ${storagePath}`);
            return;
        }

        const domainDirs = readdirSync(storagePath)
            .filter(item => statSync(join(storagePath, item)).isDirectory())
            .sort();

        let filesProcessed = 0;
        let domainsProcessed = 0;
        let totalRecords = 0;
        const outputFiles: string[] = [];

        for (const domainDir of domainDirs) {
            const domainPath = join(storagePath, domainDir);
            const domainFilename = `${domainDir.replace(/\./g, '_')}.jsonl`;
            const outputPath = join(domainPath, domainFilename);

            const dateFolders = readdirSync(domainPath)
                .filter(item => statSync(join(domainPath, item)).isDirectory())
                .sort();

            const mergedLines: string[] = [];

            for (const dateFolder of dateFolders) {
                const sourceFile = join(domainPath, dateFolder, domainFilename);

                if (!existsSync(sourceFile)) continue;

                const content = readFileSync(sourceFile, 'utf8')
                    .split('\n')
                    .filter(line => line.trim());

                if (content.length === 0) continue;

                const annotated = content.map(line => {
                    try {
                        const obj = JSON.parse(line);
                        obj._metadata = {
                            domain: domainDir,
                            crawlDate: dateFolder,
                            sourceFile: sourceFile,
                        };
                        return JSON.stringify(obj);
                    } catch {
                        return line;
                    }
                });
                mergedLines.push(...annotated);
                filesProcessed++;
                totalRecords += content.length;
                console.log(
                    `📂 ${domainDir}/${dateFolder}: appended ${content.length} records from ${domainFilename}`
                );
            }

            if (mergedLines.length === 0) {
                console.log(`ℹ️  No JSONL files found for domain ${domainDir}, skipping.`);
                continue;
            }

            writeFileSync(outputPath, mergedLines.join('\n') + '\n');
            domainsProcessed++;
            outputFiles.push(outputPath);
            console.log(
                `✅ Merged ${mergedLines.length} records for ${domainDir} into ${outputPath}`
            );
        }

        if (domainsProcessed === 0) {
            console.log('❌ No domains produced merged outputs');
            return;
        }

        console.log(
            `\n📊 Completed merge: ${domainsProcessed} domains, ${filesProcessed} source files, ${totalRecords} records.`
        );

        return { domainsProcessed, filesProcessed, outputFiles, totalRecords };
    } catch (error) {
        console.error('Error merging per-domain JSONL files:', error);
        throw error;
    }
};
