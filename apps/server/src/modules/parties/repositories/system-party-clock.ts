import { Injectable } from '@nestjs/common';
import { PartyClock } from '../ports/party-clock';

@Injectable()
export class SystemPartyClock extends PartyClock { now() { return Date.now(); } }
