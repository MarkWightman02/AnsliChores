'use strict';

const ROOMMATES = ['Sam', 'Corey', 'Anthony', 'Mark'];

const CHORES = [
  {
    name: 'Vacuum Living Room + Den',
    last_done: null,
    next_due: '2026-07-10',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: '',
    assigned: 'Sam',
    rotation: ['Sam', 'Corey', 'Anthony', 'Mark']
  },
  {
    name: 'Clean Stove',
    last_done: null,
    next_due: '2026-07-10',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: 'Wipe down stove top, front glass, and bottom drawer.',
    assigned: 'Mark',
    rotation: []
  },
  {
    name: 'Clean Out Fridge',
    last_done: null,
    next_due: '2026-07-10',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: '',
    assigned: 'All',
    rotation: []
  },
  {
    name: 'Mop Kitchen',
    last_done: null,
    next_due: '2026-07-11',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: '',
    assigned: 'Mark',
    rotation: []
  },
  {
    name: 'Thoroughly Clean Kitchen Counters',
    last_done: null,
    next_due: '2026-07-11',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: '',
    assigned: 'Mark',
    rotation: []
  },
  {
    name: 'Mow Grass',
    last_done: null,
    next_due: '2026-07-11',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: 'Rotates between Anthony and Sam.',
    assigned: 'Sam',
    rotation: ['Sam', 'Anthony']
  },
  {
    name: 'Sweep Kitchen',
    last_done: null,
    next_due: '2026-07-11',
    frequency_count: 1,
    frequency_unit: 'week',
    notes: '',
    assigned: 'Corey',
    rotation: []
  },
  {
    name: 'Clean Bathroom Floors',
    last_done: null,
    next_due: '2026-07-12',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: 'Sweep and mop.',
    assigned: 'Anthony',
    rotation: ['Sam', 'Corey', 'Anthony']
  },
  {
    name: 'Wipe Down Shower, Sink, and Mirror',
    last_done: null,
    next_due: '2026-07-12',
    frequency_count: 2,
    frequency_unit: 'week',
    notes: '',
    assigned: 'Anthony',
    rotation: ['Sam', 'Corey', 'Anthony']
  },
  {
    name: 'Clean Toilet',
    last_done: null,
    next_due: '2026-07-12',
    frequency_count: 1,
    frequency_unit: 'week',
    notes: 'Wipe down the entire exterior and brush inside.',
    assigned: 'Anthony',
    rotation: ['Sam', 'Corey', 'Anthony']
  },
  {
    name: 'Take Trash and Recycling to the Road',
    last_done: '2026-06-29',
    next_due: '2026-07-13',
    frequency_count: 1,
    frequency_unit: 'week',
    notes: 'Put out Monday night for Tuesday morning pickup. Recycling goes out every other week.',
    assigned: 'Corey',
    rotation: []
  },
  {
    name: 'Wash Kitchen Rug, Tablecloth, Throw Blankets, and Dish Drying Mat',
    last_done: null,
    next_due: '2026-07-15',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: '',
    assigned: 'Anthony',
    rotation: []
  },
  {
    name: 'Wipe Down Microwave',
    last_done: null,
    next_due: '2026-07-15',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: 'Clean inside and out.',
    assigned: 'Sam',
    rotation: []
  },
  {
    name: 'Vacuum Basement Stairs',
    last_done: null,
    next_due: '2026-07-18',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: '',
    assigned: 'Mark',
    rotation: []
  },
  {
    name: 'Wash Bath Mats',
    last_done: null,
    next_due: '2026-07-20',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: '',
    assigned: 'Sam',
    rotation: []
  },
  {
    name: 'Wash Out Trash and Recycling Bins',
    last_done: null,
    next_due: '2026-07-31',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: 'Indoor bins.',
    assigned: 'Corey',
    rotation: []
  },
  {
    name: 'Clean Out Pantry',
    last_done: null,
    next_due: '2026-07-31',
    frequency_count: 1,
    frequency_unit: 'month',
    notes: '',
    assigned: 'All',
    rotation: []
  }
];

module.exports = { CHORES, ROOMMATES };
