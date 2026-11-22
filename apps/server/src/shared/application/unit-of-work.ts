/** Opaque transaction shared by repository ports; applications do not depend on SQL. */
export interface TransactionContext { readonly id: symbol; readonly afterCommit?: (effect: () => void) => void }

export abstract class UnitOfWork {
  abstract run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
