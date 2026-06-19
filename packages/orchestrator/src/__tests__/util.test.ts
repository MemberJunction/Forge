import { describe, it, expect } from 'vitest';
import { slugify, generatePassword } from '../../dist/index.js';

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Feature X')).toBe('feature-x');
  });
  it('strips leading/trailing separators and unsafe chars', () => {
    expect(slugify('  My_Cool Feature!! ')).toBe('my-cool-feature');
  });
  it('falls back for empty input', () => {
    expect(slugify('!!!')).toBe('instance');
  });
  it('caps length at 40 chars', () => {
    expect(slugify('a'.repeat(100)).length).toBeLessThanOrEqual(40);
  });
});

describe('generatePassword', () => {
  it('is reasonably long', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(16);
  });
  it('satisfies SQL Server complexity (3+ character classes)', () => {
    const pw = generatePassword();
    const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length;
    expect(classes).toBeGreaterThanOrEqual(3);
  });
  it('produces distinct values', () => {
    expect(generatePassword()).not.toBe(generatePassword());
  });
});
