import { defineConfig } from "vitest/config";
import path from "node:path";

// テスト対象はまず権限まわりの境界(誰がどのデータに触れるか)に絞る。
// 実際のSupabaseには繋がず、DB呼び出しをその場で偽装して単体テストする
// (要件定義書10章のコスト方針もあり、テストのためだけに課金対象のSupabase呼び出しはしない)。
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
