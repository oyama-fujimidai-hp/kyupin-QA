# Kyupin QA Assistant 精神科医kyupinブログ専用 Q&A

精神科医kyupin先生のブログ「[精神科医kyupin、あるいは心を病むということ](https://ameblo.jp/kyupin/)」の記事内容に特化した、AI Q&Aアシスタントです。

## 🌟 主な特徴

- **厳密なブログ内検索**: Gemini APIを使用し、kyupin先生のブログ記事のみをソースとして回答を生成します。
- **検索履歴機能**: Googleログインにより、過去の質問と回答を自動的に保存し、いつでも振り返ることができます。
- **アクセス制限**: ホワイトリスト方式を採用し、許可されたメールアドレスのみが利用できる安全な運用が可能です。
- **レスポンシブ設計**: PCだけでなく、スマートフォンやタブレットからも快適に利用できます。

## 🚀 クイックスタート

### 1. 事前準備
- [Node.js](https://nodejs.org/) がインストールされていること。

### 2. インストール
```bash
npm install
```

### 3. 環境設定
`.env.local` ファイルを作成し、Gemini APIキーを設定してください。
```env
GEMINI_API_KEY=あなたのAPIキー
```

### 4. ローカルで実行
```bash
npm run dev
```

## 🛠 デプロイ方法

Firebase Hostingへのデプロイは以下のコマンドで行います。
```bash
npm run build
npx firebase deploy --only hosting
```

## 🔐 管理者向け設定

### ログイン許可リストの更新
利用可能なメールアドレスの制限は、`src/App.tsx` 内の `ALLOWED_EMAILS` 配列で管理しています。
```typescript
const ALLOWED_EMAILS = [
  "yas2x27@gmail.com",
  "yas2@oyama-fujimidai-hp.com",
  // ここに新しいアドレスを追加
];
```
※Firestoreのセキュリティルール（`firestore.rules`）も同様に更新する必要があります。

## 📦 技術スタック
- **Frontend**: React + Vite + TailwindCSS
- **Backend**: Firebase (Auth / Firestore / Hosting)
- **AI Model**: Gemini 1.5 Flash
