// テスト用の偽の Supabase クライアント(実際のDBには繋がない)。
// どのテーブルも、絞り込み条件は無視して、用意した行を返す。書き込みは log に残すだけ。
// 権限・費用の境界(誰の発言に印を付けられるか、印が無ければAIを呼ばない等)を確かめるのに使う。
export interface FakeAdminOptions {
  tables?: Record<string, Record<string, unknown>[]>;
  /** テーブルごとに、update(...).select().maybeSingle() が返す行(取り合い防止の「取れたか」を表す) */
  updateReturns?: Record<string, Record<string, unknown> | null>;
  rpc?: Record<string, unknown>;
}

export function fakeAdmin(options: FakeAdminOptions = {}) {
  const log: string[] = [];
  const tables = options.tables ?? {};
  const admin = {
    log,
    rpc: async (name: string) => ({ data: options.rpc?.[name] ?? null, error: null }),
    from(table: string) {
      const rows = tables[table] ?? [];
      let mode: "select" | "update" | "insert" | "delete" = "select";
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "not", "neq", "is", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => {
        if (mode === "update") {
          const ret = options.updateReturns?.[table];
          return { data: ret === undefined ? { id: "updated" } : ret, error: null };
        }
        return { data: rows[0] ?? null, error: null };
      };
      chain.single = async () => ({ data: { id: `${table}-new` }, error: null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, count: rows.length, error: null });
      chain.insert = (value: unknown) => {
        mode = "insert";
        log.push(`insert:${table}:${JSON.stringify(value)}`);
        return chain;
      };
      chain.upsert = (value: unknown) => {
        log.push(`upsert:${table}:${JSON.stringify(value)}`);
        return Promise.resolve({ error: null });
      };
      chain.update = (value: unknown) => {
        mode = "update";
        log.push(`update:${table}:${JSON.stringify(value)}`);
        return chain;
      };
      chain.delete = () => {
        mode = "delete";
        log.push(`delete:${table}`);
        return chain;
      };
      return chain;
    },
  };
  return admin;
}
