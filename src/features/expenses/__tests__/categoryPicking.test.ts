import { categoryOptions, PICKER_CATEGORIES } from '../categoryOptions';
import { guessCategory } from '../guessCategory';

describe('guessCategory', () => {
  it.each([
    ['Swiggy order', 'food'],
    ['Dinner at Barbeque Nation', 'food'],
    ['Blinkit', 'groceries'],
    ['Ola to airport', 'transport'],
    ['Petrol', 'transport'],
    ['IRCTC tickets Nagpur–Pune', 'travel'],
    ['OYO Goa', 'stay'],
    ['Electricity bill', 'utilities'],
    ['Myntra', 'shopping'],
    ['PVR movie night', 'entertainment'],
  ])('%s → %s', (description, category) => {
    expect(guessCategory(description)).toBe(category);
  });

  it('matches whole words only', () => {
    expect(guessCategory('automatic washing')).toBeNull();
    expect(guessCategory('Team outing')).toBeNull();
  });

  it('returns null for nothing useful', () => {
    expect(guessCategory('')).toBeNull();
    expect(guessCategory('x')).toBeNull();
    expect(guessCategory('Misc')).toBeNull();
  });
});

describe('categoryOptions', () => {
  const customs = ['Petrol', 'petrol', 'Maid', 'Society maintenance'];

  it('shows everything for an empty query, with custom names de-duplicated', () => {
    const o = categoryOptions('  ', customs);
    expect(o.builtIns).toEqual(PICKER_CATEGORIES);
    expect(o.builtIns).not.toContain('other');
    expect(o.customs).toEqual(['Petrol', 'Maid', 'Society maintenance']);
    expect(o.create).toBeNull();
  });

  it('filters built-ins and customs by substring, case-insensitively', () => {
    const o = categoryOptions('MAI', customs);
    expect(o.builtIns).toEqual([]);
    expect(o.customs).toEqual(['Maid', 'Society maintenance']);
    expect(o.create).toBe('MAI');
  });

  it('offers to add a new name, tidied', () => {
    expect(categoryOptions('  house   rent ', customs).create).toBe('house rent');
  });

  it('does not offer a duplicate of an existing name', () => {
    expect(categoryOptions('groceries', customs).create).toBeNull();
    expect(categoryOptions('PETROL', customs).create).toBeNull();
  });

  it('flags names that are too long', () => {
    const o = categoryOptions('a'.repeat(31), []);
    expect(o.create).toBeNull();
    expect(o.tooLong).toBe(true);
  });
});
