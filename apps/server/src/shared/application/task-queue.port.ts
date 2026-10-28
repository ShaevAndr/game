/** Handlers must be idempotent: delivery is at least once. */
export abstract class TaskQueue {
  abstract enqueue<T extends object>(queue: string, id: string, data: T): Promise<void>;
  abstract consume<T extends object>(queue: string, handler: (data: T) => Promise<void>): void;
}
