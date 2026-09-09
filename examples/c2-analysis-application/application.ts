import { c2forge } from '../../adapters/c2forge-pi/src/index.ts';
import { c2decoder } from '../../adapters/c2decoder-pi/src/index.ts';
import { postmortem } from '../../adapters/postmortem-pi/src/index.ts';
import type { ApplicationDefinition } from '../../packages/container-core/src/index.ts';
import { c2forgeProfile } from './profiles/c2forge.ts';
import { c2decoderProfile } from './profiles/c2decoder.ts';

export const c2AnalysisApplication: ApplicationDefinition = {
  id: 'c2-analysis',
  version: '0.1.0-dev.0',
  plugins: [c2forge, c2decoder, postmortem],
  profiles: [c2forgeProfile, c2decoderProfile],
};
