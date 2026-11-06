import { describe, expect, it } from 'vitest';
import { ar } from '../ar';
import { en } from '../en';
import { consumerLoad } from '../../utils/loads';

// The prompt shown when a three-phase (square) subscriber is added asks for its LOAD (A); the value
// typed is kept as the subscriber's label and read as its load. ALL VALUES SYNTHETIC.

describe('the prompt when adding a subscriber', () => {
  it('asks for the subscriber load (both languages)', () => {
    expect(ar.dialogs.labelNumberPrompt).toBe('أدخل حمل المشترك:');
    expect(en.dialogs.labelNumberPrompt).toBe('Enter subscriber load:');
    expect(ar.dialogs.labelNumberPrompt).not.toContain('رقم');
  });
  it('the value typed is the load: a square subscriber labelled «35» is a 35 A three-phase load', () => {
    expect(consumerLoad({ variant: 'square', label: '35', count: 1 })).toMatchObject({ kind: 'three', ampsEach: 35, amps: 35, source: 'label' });
    expect(consumerLoad({ variant: 'square', label: '35', count: 2 })).toMatchObject({ amps: 70 });
  });
});
