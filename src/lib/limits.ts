/**
 * Free-plan ceilings.
 *
 * The item cap is enforced in the app because items never leave the device —
 * there is nothing server-side to check against. The scan allowance is the
 * opposite: it costs real money, so the Worker is the authority and the app
 * only mirrors what the server reports.
 */
export const FREE_ITEM_LIMIT = 5;
