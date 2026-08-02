# 京都・奈良・丹後 10 日慢旅網站

## 部署檔名

上傳 GitHub Pages 時，請使用以下正式檔名：

- `index.html`
- `app.js`
- `style.css`
- `sw.js`
- `SUPABASE_SETUP.sql`
- `images/map.webp`

## Supabase 第一次安全設定

1. 登入 Supabase 專案，開啟 **SQL Editor → New query**。
2. 複製 `SUPABASE_SETUP.sql` 全部內容並按 **Run**。
3. 到 **Authentication → Users → Add user → Create new user**。
4. 輸入家人的 Email 與 Password；每位家人建立自己的帳號。
5. 建議勾選 **Auto Confirm User**，避免還需要收驗證信。
6. 重新整理網站，以剛建立的 Email／Password 登入。

`kyoto_sync` 只允許已登入帳號讀寫；匿名訪客無法直接修改行程。圖片網址可以直接顯示，但只有已登入家人能上傳或刪除。

## 離線觀看

- 網站必須部署在 HTTPS（GitHub Pages 可用），不能直接以 `file://` 開啟。
- 第一次請保持網路，開啟網站並等待頁首顯示「✓ 已可離線觀看」。
- 建議至少瀏覽一次各日期；外站封面會在第一次顯示後加入圖片快取。
- 離線時可看已下載行程、筆記與圖片；即時天氣、Windy 與新照片上傳需要網路。
- 曾在同一裝置成功登入後，離線時可按「離線查看已下載行程」。

## v40 優化內容

- 改用 Supabase Email／Password Authentication，並收緊資料表及圖片上傳權限。
- 修正 2026 星期、回程抵達時間、自駕日標示與 D5 保津川船班緩衝。
- 景點欄位、評論、導航文字及紅葉地圖完整加入家人同步。
- 加入今日模式、住宿快速卡、直接網址／地址／經緯度導航。
- 加入評論草稿保存、編輯不中斷與五秒誤刪復原。
- 加入封面失效備援、外站圖片快取與離線準備狀態。
- 移除未使用的 Leaflet，以及紐西蘭 Gaspy 殘留內容。
