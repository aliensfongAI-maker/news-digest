# 新聞摘要

公開新聞摘要站。GitHub Pages 由 **main 分支根目錄** 發佈（`index.html`、`app.js`、`styles.css`）。

介面為香港繁體中文。時間以香港時間（Asia/Hong_Kong）計算。頁面合併 **過去 24 小時** 的小時摘要。

## 資料路徑

每小時一份。`HH` 是香港時間 `00`–`23`：

```text
data/YYYY-MM-DD/HH.json
```

`YYYY-MM-DD` 是該小時所屬的香港時間曆日。日期選擇器讀取 `data/dates.json`（日期字串陣列），只列出已有任何小時檔的日子。

不再使用舊的單日檔 `data/YYYY-MM-DD.json`。

### 小時檔格式

欄目與項目欄位跟舊日檔相同，另加頂層 `hour`（`"00"`–`"23"`）：

```json
{
  "date": "YYYY-MM-DD",
  "hour": "08",
  "updatedAt": "2026-10-20T08:00:00+08:00",
  "sections": [
    {
      "id": "local",
      "title": "本地／香港",
      "items": [
        {
          "headline": "…",
          "summary": "…",
          "time_hkt": "2026-10-20T07:30:00+08:00",
          "sources": [{ "name": "…", "url": "https://…" }],
          "rank": 1
        }
      ]
    }
  ]
}
```

欄目 `id`：`local`（本地／香港）、`international`（國際）、`finance-global`（財經（全球））、`finance-hk`（財經（香港））、`tech`（科技）。

新增一小時時：放入 `data/YYYY-MM-DD/HH.json`。若該日尚未出現在 `data/dates.json`，把日期加進去。

## 前端合併

視窗終點：

- 未選日期，或選了今日：現在（香港時間）
- 選了其他日子：該日 23:59（香港時間）。若選中的日子就是今日，終點仍是現在

視窗為 `[終點 − 24 小時, 終點]`（兩端都包含）。頁面讀取所有與視窗重疊的小時檔 `data/YYYY-MM-DD/HH.json`；缺檔回 404 就略過。

合併規則：

- 只保留 `time_hkt` 落在視窗內的項目（`hour` 欄不參與篩選）
- 按欄目 id 分到五欄
- 欄內按 `time_hkt` 由新到舊
- 標題去掉首尾空白後相同，只留最新一則
- 每欄最多 10 則

## 本機預覽

需要 HTTP，不要直接開 `file://`：

```bash
python3 -m http.server 8080
```

然後開啟 `http://127.0.0.1:8080/`。
