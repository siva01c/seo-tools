# Test Suite Documentation

## Overview

Comprehensive test suite for the Metadata Crawler with unit tests, integration tests, and Apify
Actor automated tests.

## Test Structure

### Unit Tests

- **Configuration Services** (`src/tests/config/`)
  - `configService.test.ts` - YAML configuration loading and validation
  - `apifyConfig.test.ts` - Apify input handling and environment overrides

- **Storage Service** (`src/tests/services/storageService.test.ts`)
  - Domain-based storage initialization
  - Date folder creation and management
  - Apify storage configuration

- **Metadata Extraction Services** (`src/tests/services/`)
  - `metaTagService.test.ts` - SEO meta tags, Open Graph, Twitter Cards
  - `aiMetadataService.test.ts` - JSON-LD, microdata, content metrics

- **Utility Functions** (`src/tests/utils/`)
  - `linkUtils.test.ts` - Link categorization (internal/external)
  - `urlUtils.test.ts` - Homepage detection and URL validation

### Integration Tests

- **Crawler Integration** (`src/tests/integration/crawler.integration.test.ts`)
  - End-to-end crawler workflow
  - Configuration integration
  - Data extraction pipeline
  - Error handling

### Apify Actor Automated Tests

- **Actor Tests** (`src/tests/apify/actor.automated.test.ts`)
  - Based on
    [Apify's testing guidelines](https://docs.apify.com/platform/actors/development/automated-tests)
  - Run status validation
  - Dataset content validation
  - Key-value store tests
  - Performance and resource tests
  - Error handling validation

## Running Tests

### Local Development

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npx vitest src/tests/services/metaTagService.test.ts

# Run tests for specific pattern
npx vitest src/tests/utils/
```

### Docker Testing

```bash
# Build and test in Docker
docker build -t metadata-crawler .
docker run metadata-crawler npm test
```

## Test Categories

### 1. Configuration Tests

- **Validation**: Ensures proper configuration structure
- **Environment Overrides**: Tests environment variable precedence
- **Error Handling**: Missing or invalid configuration scenarios

### 2. Storage Tests

- **Domain Extraction**: Validates domain parsing from URLs
- **Path Generation**: Tests storage directory structure creation
- **Data Organization**: Verifies domain/date-based organization

### 3. Metadata Extraction Tests

- **SEO Tags**: Meta tags, Open Graph, Twitter Cards validation
- **Structured Data**: JSON-LD and microdata extraction
- **Content Metrics**: Word count, reading time calculations
- **Link Analysis**: Internal/external link categorization

### 4. Integration Tests

- **Command Line Parsing**: URL argument handling
- **Storage Integration**: Domain-based storage workflow
- **Data Pipeline**: Complete extraction to storage flow

### 5. Apify Actor Tests

- **Input Validation**: Actor input structure verification
- **Dataset Validation**: Output data format compliance
- **Performance**: Request limits and concurrency checks
- **Error Scenarios**: Graceful failure handling

## Test Data Validation

### Dataset Item Structure

```typescript
interface DatasetItem {
  title: string;
  url: string;
  timestamp: string; // ISO 8601 format
  response: {
    status: number; // 100-599
    statusText: string;
    headers: object;
    url: string;
  };
  links: {
    internal: LinkData[];
    external: LinkData[];
    total: number;
  };
  seo: {
    metaTags: object;
    specialLinks: object;
    hasDataNoSnippet: boolean;
  };
  aiMetadata: {
    structuredData: {
      jsonLd: object[];
      microdata: object[];
    };
    customMetadata: object;
    pageMap?: object;
  };
}
```

## Test Coverage Areas

### ✅ Covered

- Configuration loading and validation
- Storage service functionality
- Meta tag extraction
- Link categorization
- URL validation
- Actor input/output validation
- Error handling scenarios

### 🔄 Partial Coverage

- Sitemap service integration
- File service operations
- Logger functionality

### ⚠️ Areas for Future Testing

- Browser automation scenarios
- Network timeout handling
- Large-scale crawling performance
- Memory usage optimization

## Mock Strategy

### External Dependencies

- **Apify Actor**: Mocked for isolated testing
- **Playwright Page**: Mocked for DOM interaction testing
- **File System**: Mocked for storage operations
- **Network Requests**: Mocked for predictable testing

### Test Data

- **Realistic URLs**: Various domain and path combinations
- **Meta Tag Examples**: Complete SEO and social media tags
- **Structured Data**: Valid JSON-LD and microdata samples
- **Error Scenarios**: Invalid URLs, malformed data

## Continuous Integration

### Test Automation

- **Pre-commit**: Run critical tests before commits
- **CI Pipeline**: Full test suite on pull requests
- **Deployment**: Tests must pass before production deployment

### Performance Benchmarks

- **Test Execution Time**: < 30 seconds for full suite
- **Memory Usage**: < 512MB during test execution
- **Coverage Target**: > 80% line coverage

## Debugging Tests

### Common Issues

1. **Mock Mismatches**: Verify mocks match actual implementation
2. **Async Timing**: Ensure proper async/await usage
3. **Environment Variables**: Clear environment between tests
4. **File System**: Proper mocking of fs operations

### Debug Commands

```bash
# Verbose test output
npx vitest --reporter=verbose

# Debug specific test
npx vitest --debug src/tests/services/metaTagService.test.ts

# Coverage report
npx vitest --coverage
```

## Quality Assurance

### Test Quality Metrics

- **Assertion Coverage**: Each test validates multiple aspects
- **Edge Cases**: Invalid inputs, network errors, empty responses
- **Real-world Scenarios**: Actual website structures and patterns
- **Regression Prevention**: Tests for previously fixed bugs

### Best Practices

- **Descriptive Names**: Clear test and assertion descriptions
- **Isolated Tests**: No dependencies between test cases
- **Realistic Data**: Test data mirrors production scenarios
- **Error Scenarios**: Comprehensive failure mode testing
