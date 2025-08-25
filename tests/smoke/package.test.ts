import { describe, it, expect } from 'vitest';
import { hello } from '../../src/index';

describe('package', () => {
  it('exports hello', () => {
    expect(hello()).toBe('ai-nes-gpt5');
  });
});
