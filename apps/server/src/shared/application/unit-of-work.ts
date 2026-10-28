/** Opaque transaction shared by repository ports; applications do not depend on SQL. */
export interface TransactionContext { readonly id: symbol }

export abstract class UnitOfWork {
  abstract run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
