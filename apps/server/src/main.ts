import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
// Load before importing modules: gateway options and database URLs read environment variables.
config({ path: resolve(process.cwd(), '../../.env') }); config();

async function bootstrap() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app.module');
  const { ValidationFilter } = await import('./shared/http/validation.filter');
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalFilters(new ValidationFilter()); app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
bootstrap().catch(error => { console.error(error); process.exit(1); });
