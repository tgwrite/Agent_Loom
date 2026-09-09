import { decoderHandoffRequirement } from '../../../adapters/c2decoder-pi/src/index.ts';
import type { SessionProfile } from '../../../packages/container-core/src/index.ts';

export const c2decoderProfile: SessionProfile = {
  id: 'c2decoder',
  primary: 'c2decoder',
  aspects: ['postmortem'],
  requirements: [decoderHandoffRequirement],
};
