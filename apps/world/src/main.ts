import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(process.cwd(), '../../.env') }); config();

async function bootstrap() {
  const { NestFactory } = await import('@nestjs/core');
  const { WorldAppModule } = await import('./app.module');
  const { ValidationFilter } = await import('./shared/http/validation.filter');
  const app = await NestFactory.create(WorldAppModule);
  app.setGlobalPrefix('api/v1'); app.useGlobalFilters(new ValidationFilter()); app.enableShutdownHooks();
  await app.listen(Number(process.env.WORLD_PORT ?? 3002), process.env.WORLD_HOST ?? '127.0.0.1');
  console.log(`WORLD_LISTENING ${(app.getHttpServer().address() as { port: number }).port}`);
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1; });
