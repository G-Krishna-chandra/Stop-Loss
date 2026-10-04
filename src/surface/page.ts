import { readFileSync } from 'node:fs';

export const PAGE = readFileSync(new URL('./page.html', import.meta.url), 'utf8');
