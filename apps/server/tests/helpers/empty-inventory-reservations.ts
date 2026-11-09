import type { InventoryReservationsRepository } from '../../src/modules/inventory/ports/inventory-reservations.repository';
/** Existing inventory fixtures contain no world reservations. Positive cases use the real adapter. */
export const emptyInventoryReservations: InventoryReservationsRepository = {
  forOwner: async () => [], reserve: async () => true, release: async () => {},
};
