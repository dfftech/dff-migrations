/** Quote a postgres identifier: my"schema → "my""schema". */
export function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
