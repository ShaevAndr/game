import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { MessageFailure } from '../application/message-bus';
export async function handleMessage(work: () => Promise<unknown>) {
  try { return await work(); }
  catch (error) {
    if (error instanceof ZodError) throw new MessageFailure('Некорректный контракт сообщения', false, 'MESSAGE_PAYLOAD');
    if (error instanceof HttpException && error.getStatus() < 500) {
      const response = error.getResponse(), code = typeof response === 'object' && 'code' in response ? String(response.code) : `HTTP_${error.getStatus()}`;
      throw new MessageFailure(error.message, code === 'WORLD_DELIVERY_GAP', code);
    }
    throw error;
  }
}
