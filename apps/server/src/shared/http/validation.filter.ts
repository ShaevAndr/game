import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

@Catch(ZodError)
export class ValidationFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(400).json({
      message: exception.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    });
  }
}
