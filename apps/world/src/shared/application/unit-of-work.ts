export interface TransactionContext { readonly id: symbol }
export abstract class UnitOfWork {
  abstract run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
}
