# 新聞摘要

公開新聞摘要站。GitHub Pages 由 **main 分支根目錄** 發佈（`index.html`、`app.js`、`styles.css`）。

介面為香港繁體中文。時間以香港時間（Asia/Hong_Kong）計算。

## 資料路徑

每日一份：

```text
data/YYYY-MM-DD.json
```

`YYYY-MM-DD` 是香港時間的曆日。日期選擇器讀取 `data/dates.json`（日期字串陣列），只列出已有 JSON 的日子。

新增一天時：放入 `data/YYYY-MM-DD.json`，並把該日加進 `data/dates.json`。

## 本機預覽

需要 HTTP，不要直接開 `file://`：

```bash
python3 -m http.server 8080
```

然後開啟 `http://127.0.0.1:8080/`。
