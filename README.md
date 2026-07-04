# 底値帳 — スマート家計簿 PWA（雛形）

レシートを読み取り、品目ごとの価格履歴から「どの店がいちばん安いか（底値）」を見つける個人用アプリ。
維持費0円構成：**GitHub Pages（PWA）↔ Google Apps Script（API）↔ Googleスプレッドシート（DB）**

## ファイル構成

```
kakeibo-pwa/
├── index.html      … アプリ本体（HTML/CSS/JSすべて込み・依存ライブラリなし）
├── manifest.json   … PWA設定（ホーム画面追加用）
├── sw.js           … Service Worker（本体のオフラインキャッシュ）
├── icons/          … アプリアイコン（192px / 512px）
└── README.md       … このファイル
```

## まず動かす（デモモード）

`index.html` を開くだけで動きます。GAS未設定の間は**デモモード**として、
サンプルデータ（直近70日ぶんの購入履歴）と**擬似OCR**が組み込まれています。

体験手順：

1. **ホーム** →「📷 レシートを読み取る」→ 適当な写真を選ぶ → 疑似OCRが走り**確認画面**へ
   - 緑＝辞書で自動一致 ／ 黄＝候補あり（タップで選択）／ 赤＝未知（検索 or 新規登録）
   - 未知の「ﾁｰｽﾞﾆｸﾏﾝ」を新規登録して「確定して保存」すると、**次回から自動一致（緑）になる**＝辞書学習の体験
2. **底値検索** →「牛乳」で検索 → 直近90日の底値と店舗が強調表示、履歴は安い順
3. **カレンダー** → 日別合計の濃淡表示 → 日付タップで明細シート

※ ブラウザのプレビュー環境によっては保存（localStorage）が効きません。GitHub Pages に置けば設定・キャッシュが端末に保存されます。

## GitHub Pages で公開する

1. GitHubで新規リポジトリを作成（無料プランのPagesは**Publicリポジトリ**が必要）
2. このフォルダの中身をリポジトリ直下にpush
3. リポジトリの Settings → Pages → Branch: `main` / `(root)` → Save
4. 数分後 `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される
5. スマホでURLを開き、「ホーム画面に追加」（iOSはSafariの共有メニュー、Androidはメニュー→インストール）

**セキュリティ上の注意**：リポジトリは公開されるため、**GASのURLやトークンをコードに直書きしない**こと。
アプリの「設定」タブから入力すると、その端末のlocalStorageにのみ保存されます。

カメラ起動とService WorkerはHTTPS必須です（GitHub PagesはHTTPSなのでOK）。

## GAS側 API 仕様（次の実装ステップ）

PWAは GAS WebアプリのURLへ **`Content-Type`ヘッダなしのPOST**（＝`text/plain`扱い）でJSONを送ります。
GAS側は `doPost(e)` で `JSON.parse(e.postData.contents)` を受け、以下の3アクションを実装してください。
すべてのリクエストに `token` が含まれるので、設定した合言葉と一致しなければ `{error:"unauthorized"}` を返します。

### 1) `getAll` — 全データ取得（起動時に1回）

リクエスト: `{ "action":"getAll", "token":"…" }`

レスポンス:
```json
{
  "items":    [{ "id":"I…", "date":"2026-07-03", "storeId":"S1", "productId":"P1",
                 "raw":"ｷﾞｭｳﾆｭｳ 1000ML", "price":178, "qty":1, "discount":0,
                 "status":"確定", "method":"OCR" }],
  "products": [{ "id":"P1", "name":"明治おいしい牛乳", "category":"乳製品", "amount":1000, "unit":"ml" }],
  "stores":   [{ "id":"S1", "name":"OKストア" }],
  "aliases":  [{ "norm":"ギュウニュウ1000ML", "storeId":"S1", "productId":"P1" }]
}
```

### 2) `ocr` — レシート画像の読み取り

リクエスト: `{ "action":"ocr", "token":"…", "image":"<base64 JPEG>", "mime":"image/jpeg" }`

処理: base64→Blob化 → **Drive OCR**（`Drive.Files.insert` を `ocr:true, ocrLanguage:'ja'` でGoogleドキュメント変換）→
テキストを `normalize('NFKC')` → 行パース（品目/価格/数量/値引の抽出、合計・税行の除外）→ 一時Docは削除。

レスポンス:
```json
{ "date":"2026-07-03", "storeHint":"OKストア", "total":561,
  "lines":[{ "raw":"ｷﾞｭｳﾆｭｳ 1000ML", "price":178, "qty":1, "discount":0 }] }
```
※ 商品マッチング（辞書照合・類似候補）は**フロント側**が行うので、GASは「テキスト→構造化」だけでよい。

### 3) `save` — 確定データの保存

リクエスト:
```json
{ "action":"save", "token":"…",
  "items":[…上記itemsと同形…],
  "newProducts":[…], "newStores":[…], "newAliases":[…] }
```
処理: 各シートへ `appendRow`（複数行は `setValues` で一括）。`LockService` で排他。
レスポンス: `{ "ok": true }`

## スプレッドシートの構成（1シート＝1テーブル）

| シート名 | 列（1行目ヘッダ） |
|---|---|
| 購入明細 | id / date / storeId / productId / raw / price / qty / discount / status / method |
| 商品マスタ | id / name / category / amount / unit |
| 店舗マスタ | id / name |
| 表記揺れ辞書 | norm / storeId / productId |

- IDはフロントで生成（`I…` `P…` `S…` プレフィックス＋タイムスタンプ）。GAS側での採番は不要
- `raw` はレシート印字の原文。**OCRの誤読も同じ店では毎回同じ誤読**になるため、そのまま辞書学習に使える
- 単価は税込で統一する運用を推奨

## 開発メモ

- **CORS**: fetchに`Content-Type`を付けない（付けるとプリフライトOPTIONSが飛び、GASが応答できない）
- **SWキャッシュ**: `index.html`等を更新したら `sw.js` の `CACHE_VERSION` を上げる（上げないと古い画面が出続ける）
- **GASデプロイ**: コード修正後は「新しいデプロイ」を作成しないと反映されない
- 起動時に全件取得→検索・ソート・集計はすべてフロントで実行（個人規模なら数千行でも一瞬）

## TODO（今後の拡張候補）

- 100ml/100gあたり単価の表示（規格違い商品の比較）
- CSVエクスポート、レシート画像のDrive保存とリンク
- 「未確認」明細の一覧画面（保存だけして後で確認する運用）
