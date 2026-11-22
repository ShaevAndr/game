import { Global, Module } from '@nestjs/common';
import { StateChanges } from '../../shared/application/state-changes';
import { InProcessStateChanges } from './in-process-state-changes';

@Global()
@Module({ providers: [{ provide: StateChanges, useClass: InProcessStateChanges }], exports: [StateChanges] })
export class StateChangesModule {}
