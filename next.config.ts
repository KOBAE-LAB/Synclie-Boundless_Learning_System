import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // 資料・手書き画像・音声はサーバーアクション経由でアップロードする。既定の1MBでは
      // 足りないため引き上げる(VPS上のnginxの client_max_body_size と揃えること。
      // deploy/nginx-synclie.conf を参照)。
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
