/**
 * Channels excluded from archiving by policy — hard block, wins over any
 * include mechanism. Mirror of the top-level `excluded_channels.py` (keep the
 * two in sync). See `specs/internal-discuss-on-demand.md`.
 */

export const EXCLUDED_CHANNEL_IDS = new Set([
	"1412294350645493840", // internal-discuss
])
