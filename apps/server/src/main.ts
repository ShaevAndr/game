import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
// Load before importing modules: gateway options and database URLs read environment variables.
config({ path: resolve(process.cwd(), '../../.env') }); config();

async function bootstrap() {
  const { Module, Catch } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { ZodError } = await import('zod');
  const { DatabaseModule } = await import('./database/database.module');
  const { ContentModule } = await import('./content/content.module');
  const { CharactersModule } = await import('./characters/characters.module');
  const { BattlesModule } = await import('./battles/battles.module');
  @Module({ imports: [DatabaseModule, ContentModule, CharactersModule, BattlesModule] }) class AppModule {}
  @Catch(ZodError)
  class ValidationFilter {
    catch(exception: InstanceType<typeof ZodError>, host: import('@nestjs/common').ArgumentsHost) {
      host.switchToHttp().getResponse().status(400).json({ message: exception.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
  }
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api'); app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173' });
  app.useGlobalFilters(new ValidationFilter()); app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
bootstrap().catch(error => { console.error(error); process.exit(1); });
