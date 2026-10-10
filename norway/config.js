/* ▼ 狐光漫遊：Supabase 設定（只要填一次）▼
   與北海道版共用同一個 Supabase 專案（資料存在另一張 norway_sync 資料表，不會互相覆蓋）。
   第一次使用前，請到 Supabase → SQL Editor 執行 SUPABASE_SETUP.sql 一次。
   兩個都留空 = 單機預覽模式（不用登入，資料只存在這台裝置）。
   之後更新網站時，這個檔案「不要覆蓋」，其他檔案照常換新即可。 */
window.NORWAY_CONFIG = {
  SUPABASE_URL: "https://ieiiqpscadmgyaupnbsn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_oGSKzt4YnzCjPn9XUyvKiw_Wya-0OPY"
};
