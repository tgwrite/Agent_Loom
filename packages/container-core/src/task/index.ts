import type { ApplicationDefinition } from '../application/index.ts';

export interface TaskRecord {
  schema_version: 3;
  id: string;
  application_id: string;
  application: ApplicationDefinition;
  title: string;
  created_at: string;
}
