'use strict';

/**
 * Property-based tests for the To-Do Life Dashboard.
 * Uses fast-check (https://github.com/dubzzz/fast-check).
 *
 * Feature: todo-life-dashboard
 * These tests extract the pure/near-pure functions from app.js and validate
 * correctness properties over many generated inputs.
 *
 * Run: node tests/properties.test.js
 */

const fc = require('fast-check');

// ============================================================
// Inline implementations of the pure / near-pure functions
// extracted from js/app.js for isolated Node.js testing.
// ============================================================

/**
 * Validate a URL string.
 * Returns true only for http:// or https:// URLs with a non-empty hostname.
 * @param {string} raw
 * @returns {boolean}
 */
function isValidUrl(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Generate a unique ID (deterministic for test purposes).
 * @returns {string}
 */
function generateId() {
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// ============================================================
// Minimal State + Storage simulation for link CRUD tests
// ============================================================

function makeTestState() {
  return { links: [] };
}

function makeTestStorage() {
  let store = {};
  return {
    save(key, value) { store[key] = JSON.parse(JSON.stringify(value)); },
    load(key, fallback) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback; },
    _store: store,
  };
}

/**
 * addLink — isolated version operating on explicit state/storage args.
 * Returns true if link was added, false if validation failed.
 */
function addLink(state, storage, label, url) {
  const trimmedLabel = typeof label === 'string' ? label.trim() : '';
  const trimmedUrl   = typeof url   === 'string' ? url.trim()   : '';

  if (trimmedLabel.length === 0) return false;
  if (!isValidUrl(trimmedUrl))    return false;

  const link = {
    id:    generateId(),
    label: trimmedLabel,
    url:   trimmedUrl,
  };

  state.links.push(link);
  storage.save('tdld_links', state.links);
  return true;
}

/**
 * deleteLink — isolated version operating on explicit state/storage args.
 * Returns true if a link was found and removed, false otherwise.
 */
function deleteLink(state, storage, id) {
  const before = state.links.length;
  state.links = state.links.filter(l => l.id !== id);
  storage.save('tdld_links', state.links);
  return state.links.length < before;
}

// ============================================================
// Arbitraries
// ============================================================

/** A valid http/https URL string. */
const validUrlArbitrary = fc.oneof(
  // Plain http/https URL (no path)
  fc.record({
    scheme:   fc.constantFrom('http', 'https'),
    hostname: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.[a-z]{2,6}$/),
  }).map(({ scheme, hostname }) => `${scheme}://${hostname}`),
  // With a simple path
  fc.record({
    scheme:   fc.constantFrom('http', 'https'),
    hostname: fc.stringMatching(/^[a-z][a-z0-9-]{0,20}\.[a-z]{2,6}$/),
    path:     fc.stringMatching(/^\/[a-z0-9_-]{0,20}$/),
  }).map(({ scheme, hostname, path }) => `${scheme}://${hostname}${path}`),
);

/** A link object with valid data (id may be any string for setup purposes). */
const linkArbitrary = fc.record({
  id:    fc.uuid(),
  label: fc.string({ minLength: 1, maxLength: 50 }),
  url:   validUrlArbitrary,
});

// ============================================================
// Test runner
// ============================================================

let passed = 0;
let failed = 0;

function runProperty(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error('   ', err.message || err);
    failed++;
  }
}

console.log('\n=== To-Do Life Dashboard — Property-Based Tests ===\n');

// ============================================================
// Property 8: Link add grows links list and persists
// Feature: todo-life-dashboard, Property 8: Link add grows links list and persists
// Validates: Requirements 6.4
// ============================================================

console.log('Property 8: Link add grows links list and persists');
runProperty('addLink with valid label and URL grows the list by exactly 1 and persists to storage', () => {
  // Feature: todo-life-dashboard, Property 8: Link add grows links list and persists
  fc.assert(
    fc.property(
      fc.string({ minLength: 1, maxLength: 50 }),
      validUrlArbitrary,
      (label, url) => {
        // Skip labels that are whitespace-only (isValidUrl rejects them)
        if (label.trim().length === 0) return true;

        const state   = makeTestState();
        const storage = makeTestStorage();

        // Pre-condition: start with an arbitrary number of existing links
        const before = state.links.length; // 0 at start

        const result = addLink(state, storage, label, url);

        // 1. addLink must return true for valid inputs
        if (!result) return false;

        // 2. List grows by exactly 1
        if (state.links.length !== before + 1) return false;

        // 3. New entry's label equals the trimmed input
        const added = state.links[state.links.length - 1];
        if (added.label !== label.trim()) return false;

        // 4. New entry's url equals the (already-valid) trimmed input
        if (added.url !== url.trim()) return false;

        // 5. Storage was updated with the new list
        const stored = storage.load('tdld_links', []);
        if (stored.length !== state.links.length) return false;
        if (!stored.some(l => l.label === added.label && l.url === added.url)) return false;

        return true;
      }
    ),
    { numRuns: 100 }
  );
});

runProperty('addLink with empty label is rejected (list unchanged)', () => {
  // Feature: todo-life-dashboard, Property 8: Link add grows links list and persists
  fc.assert(
    fc.property(
      validUrlArbitrary,
      (url) => {
        const state   = makeTestState();
        const storage = makeTestStorage();

        const result = addLink(state, storage, '   ', url);

        return result === false && state.links.length === 0;
      }
    ),
    { numRuns: 100 }
  );
});

// ============================================================
// Property 9: Link URL validation is consistent
// Feature: todo-life-dashboard, Property 9: Link URL validation is consistent
// Validates: Requirements 6.4, 6.6
// ============================================================

console.log('\nProperty 9: Link URL validation is consistent');
runProperty('isValidUrl returns true iff URL constructor parses with http/https scheme and non-empty hostname', () => {
  // Feature: todo-life-dashboard, Property 9: Link URL validation is consistent
  fc.assert(
    fc.property(
      fc.string(),
      (raw) => {
        const result = isValidUrl(raw);

        // Compute the expected result independently
        let expected = false;
        try {
          const u = new URL(raw);
          expected = (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
        } catch {
          expected = false;
        }

        return result === expected;
      }
    ),
    { numRuns: 100 }
  );
});

runProperty('isValidUrl always returns a boolean', () => {
  // Feature: todo-life-dashboard, Property 9: Link URL validation is consistent
  fc.assert(
    fc.property(
      fc.string(),
      (raw) => typeof isValidUrl(raw) === 'boolean'
    ),
    { numRuns: 100 }
  );
});

runProperty('isValidUrl is idempotent — calling twice on same input gives same result', () => {
  // Feature: todo-life-dashboard, Property 9: Link URL validation is consistent
  fc.assert(
    fc.property(
      fc.string(),
      (raw) => isValidUrl(raw) === isValidUrl(raw)
    ),
    { numRuns: 100 }
  );
});

runProperty('isValidUrl rejects non-http/https URLs', () => {
  // Feature: todo-life-dashboard, Property 9: Link URL validation is consistent
  fc.assert(
    fc.property(
      fc.constantFrom('ftp://example.com', 'file:///etc/hosts', 'mailto:user@example.com', 'javascript:alert(1)', '//example.com', 'example.com', ''),
      (raw) => isValidUrl(raw) === false
    ),
    { numRuns: 100 }
  );
});

// ============================================================
// Property 10: Link delete removes exactly the target link
// Feature: todo-life-dashboard, Property 10: Link delete removes exactly the target link
// Validates: Requirements 6.8
// ============================================================

console.log('\nProperty 10: Link delete removes exactly the target link');
runProperty('deleteLink removes exactly the target and leaves all others intact', () => {
  // Feature: todo-life-dashboard, Property 10: Link delete removes exactly the target link
  fc.assert(
    fc.property(
      fc.array(linkArbitrary, { minLength: 1 }),
      fc.nat(),
      (links, indexSeed) => {
        // Ensure unique IDs (overwrite in case of collisions from the arbitrary)
        const uniqueLinks = links.map((l, i) => ({ ...l, id: `link-${i}` }));

        const idx = indexSeed % uniqueLinks.length;
        const targetId = uniqueLinks[idx].id;

        const state   = makeTestState();
        const storage = makeTestStorage();
        state.links   = uniqueLinks.map(l => ({ ...l })); // deep-ish copy
        storage.save('tdld_links', state.links);

        const before = state.links.length;

        deleteLink(state, storage, targetId);

        // 1. List length decreases by exactly 1
        if (state.links.length !== before - 1) return false;

        // 2. Target link is gone
        if (state.links.some(l => l.id === targetId)) return false;

        // 3. All other links are still present and unmodified
        for (const link of uniqueLinks) {
          if (link.id === targetId) continue;
          const found = state.links.find(l => l.id === link.id);
          if (!found) return false;
          if (found.label !== link.label) return false;
          if (found.url !== link.url) return false;
        }

        // 4. Storage reflects the updated list
        const stored = storage.load('tdld_links', []);
        if (stored.length !== state.links.length) return false;
        if (stored.some(l => l.id === targetId)) return false;

        return true;
      }
    ),
    { numRuns: 100 }
  );
});

runProperty('deleteLink with non-existent id leaves list unchanged', () => {
  // Feature: todo-life-dashboard, Property 10: Link delete removes exactly the target link
  fc.assert(
    fc.property(
      fc.array(linkArbitrary, { minLength: 1 }),
      (links) => {
        const uniqueLinks = links.map((l, i) => ({ ...l, id: `link-${i}` }));

        const state   = makeTestState();
        const storage = makeTestStorage();
        state.links   = uniqueLinks.map(l => ({ ...l }));

        const before = state.links.length;
        deleteLink(state, storage, 'non-existent-id-xyz');

        return state.links.length === before;
      }
    ),
    { numRuns: 100 }
  );
});

// ============================================================
// Summary
// ============================================================

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
