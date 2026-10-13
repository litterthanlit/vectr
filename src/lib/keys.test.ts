import { describe, expect, it } from 'vitest';
import { isTyping } from './keys';

const on = (target: object | null) => isTyping({ target: target as EventTarget | null });

describe('isTyping', () => {
  it('is true for text entry and keyboard-operated controls', () => {
    expect(on({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(on({ tagName: 'INPUT', type: 'color' })).toBe(true);
    expect(on({ tagName: 'TEXTAREA' })).toBe(true);
    expect(on({ tagName: 'SELECT' })).toBe(true);
    expect(on({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('is false for everything else, including range sliders', () => {
    expect(on({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(on({ tagName: 'BUTTON' })).toBe(false);
    expect(on({ tagName: 'DIV', isContentEditable: false })).toBe(false);
    expect(on({ tagName: 'BODY' })).toBe(false);
    expect(on(null)).toBe(false);
    expect(on({})).toBe(false);
  });
});
