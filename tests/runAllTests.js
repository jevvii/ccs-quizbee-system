/**
 * Unified Test Runner: OLFU IT Olympics LAN Quiz Bee System
 * Executes all opaque-box test suites across Tiers 1-4 and 30+ Headless Socket Simulation.
 * 
 * Supports:
 * - node --test tests/runAllTests.js
 * - node tests/runAllTests.js
 * - npm test
 */

const path = require('node:path');

// Test Suite Manifest
const SUITES = [
  { tier: 'Tier 1', name: 'Feature Coverage (R1–R5)', file: './e2e/tier1_features.test.js' },
  { tier: 'Tier 2', name: 'Boundary & Edge Cases', file: './e2e/tier2_boundaries.test.js' },
  { tier: 'Tier 3', name: 'Pairwise & Multi-View Interactions', file: './e2e/tier3_interactions.test.js' },
  { tier: 'Tier 4', name: 'Real-World Tournament Scenarios', file: './e2e/tier4_realworld.test.js' },
  { tier: 'Simulation', name: '30+ Headless Socket Contestant Swarm (R6)', file: './simulation.test.js' }
];

// Load and register all test suites with Node.js test runner
for (const suite of SUITES) {
  require(suite.file);
}
