# モノマッチ 実証実験版

物品の「欲しい」「提供できる」を登録し、距離順に自動マッチング → チャットまで行える
Webアプリです。GitHub Pages（フロント）+ Firebase（データベース・認証）だけで動くので、
自前のサーバーは不要です。無料枠のみでOKな規模（10〜30人・数週間）を想定しています。

## 1. Firebase プロジェクトを作る（5分）

1. https://console.firebase.google.com/ にアクセスし、Googleアカウントでログイン
2. 「プロジェクトを作成」→ 名前を入力（例：monomatch-pilot）→ 作成
3. 左メニュー「Firestore Database」→「データベースの作成」
   - ロケーションは `asia-northeast1`（東京）を推奨
   - モードは「本番環境モード」でOK（ルールは後で上書きします）
4. 左メニュー「Authentication」→「Sign-in method」→「匿名」を有効化
5. 左メニュー「プロジェクトの設定」（歯車アイコン）→ 下にスクロールし
   「マイアプリ」→ `</>`（ウェブ）アイコンをクリックしてアプリを登録
   - アプリのニックネームは何でもOK（例：monomatch-web）
   - 「Firebase Hosting も設定する」はチェックしなくてOK（GitHub Pagesを使うため）
6. 表示された `firebaseConfig` の中身をコピーしておく

## 2. Firestore のルールを設定する

Firebaseコンソール →「Firestore Database」→「ルール」タブを開き、
このリポジトリの `firestore.rules` の中身を貼り付けて「公開」をクリック。

## 3. 設定ファイルを作る

`firebase-config.sample.js` を `firebase-config.js` という名前でコピーし、
手順1でコピーした値を貼り付けます。

```bash
cp firebase-config.sample.js firebase-config.js
# firebase-config.js を開いて値を書き換える
```

参加者だけがアクセスできるよう、`ACCESS_CODE` に簡単な合言葉を設定しておくと安心です
（強固なセキュリティではありませんが、身内テストの誤アクセス防止には十分です）。

## 4. GitHub にアップロードして公開する

すでに GitHub アカウント（satogy）をお持ちなので、次の手順で進められます。

```bash
# このフォルダの中身をそのまま新しいリポジトリにする場合
git init
git add .
git commit -m "モノマッチ 実証実験版"
git branch -M main
git remote add origin https://github.com/satogy/monomatch-pilot.git
git push -u origin main
```

その後 GitHub 上で：
1. リポジトリの「Settings」→「Pages」を開く
2. 「Source」を `main` ブランチ / `/(root)` に設定して保存
3. 数分後、`https://satogy.github.io/monomatch-pilot/` で公開されます

## 5. 参加者への案内

公開されたURL（と合言葉を設定した場合はその合言葉）を参加者に共有するだけで、
スマホ・PCのブラウザからそのまま使えます。アプリのインストールは不要です。

## 6. 実験中〜実験後にできること

- 「管理画面」タブから常に最新の登録・マッチングデータをその場で確認可能
- 「CSVエクスポート」ボタンで登録一覧・マッチング一覧をダウンロードし、
  Excel/スプレッドシートで詳細な分析が可能
- Firebaseコンソールの「Firestore Database」からも生データを直接閲覧できます

## 注意点（実証実験としての限界）

- 匿名認証のみのため、ブラウザのデータを消すと再ログインが必要になります
  （表示名を選び直すだけで再開できますが、過去の自分の登録とは紐付きません）
- 小規模な検証用の構成です。本格運用する場合は認証方式の強化（メール認証等）や
  マッチングロジックのサーバーサイド化（Cloud Functions）を検討してください
- Firebase 無料枠（Sparkプラン）で今回の規模は十分ですが、想定より利用者が増える
  場合は使用量をFirebaseコンソールで確認してください
