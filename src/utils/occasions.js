// This is a product assignment, not an occasions taxonomy row. Keeping it
// separate means it is never shown as a customer-facing occasion and it
// automatically covers occasions an admin creates later.
export const ALL_OCCASIONS_SLUG = 'all-occasions';
export const ALL_OCCASIONS_NAME = 'All Occasions';

// Accept the human-readable label as well as the select option's slug. This
// makes the admin API resilient to both existing form implementations.
export function normalizeAllOccasions(value) {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase() === ALL_OCCASIONS_NAME.toLowerCase()
    ? ALL_OCCASIONS_SLUG
    : value;
}
