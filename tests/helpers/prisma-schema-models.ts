import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

export interface SchemaModel {
  name: string;
  /** Physical table name (@@map), falling back to the model name. */
  table: string;
  fields: string[];
  hasTenantId: boolean;
}

/**
 * Parse prisma/schema/*.prisma into a model list.
 *
 * Deliberately a text parse rather than reading the generated client: the
 * guardrail must fail when the SCHEMA and the MIGRATIONS disagree, and the
 * generated client is derived from the schema — so it could never disagree
 * with it. Reading the source of truth is the whole point.
 */
export function parseSchemaModels(pattern = 'prisma/schema/*.prisma'): SchemaModel[] {
  const models: SchemaModel[] = [];

  for (const file of globSync(pattern)) {
    const src = readFileSync(file.toString(), 'utf8');

    // model Foo { ... } — non-greedy to the first closing brace at col 0.
    const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
    let m: RegExpExecArray | null;

    while ((m = re.exec(src)) !== null) {
      const [, name, body] = m;
      const fields: string[] = [];

      for (const line of body!.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('//') || t.startsWith('@@') || t.startsWith('///')) continue;
        const field = t.split(/\s+/)[0];
        if (field) fields.push(field);
      }

      const mapMatch = body!.match(/@@map\("([^"]+)"\)/);

      models.push({
        name: name!,
        table: mapMatch?.[1] ?? name!,
        fields,
        hasTenantId: fields.includes('tenantId'),
      });
    }
  }

  return models;
}

/** Every migration's SQL, concatenated. */
export function allMigrationSql(pattern = 'prisma/migrations/**/migration.sql'): string {
  return globSync(pattern)
    .map((f) => readFileSync(f.toString(), 'utf8'))
    .join('\n');
}
