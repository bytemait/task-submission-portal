import { DatabaseSync, backup } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const source = resolve(process.env.DB_PATH || '/app/data/submissions.sqlite');
const destination = resolve(process.env.BACKUP_PATH || `/app/data/backup-${new Date().toISOString().replaceAll(':', '-')}.sqlite`);
if (source === destination) throw new Error('BACKUP_PATH must be different from DB_PATH.');
mkdirSync(dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  console.log(`Consistent SQLite backup created at ${destination}`);
} finally {
  db.close();
}
