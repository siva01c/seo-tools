// Jest setup file for global test configuration

// Mock console methods to reduce test noise
global.console = {
    ...console,
    log: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
};
