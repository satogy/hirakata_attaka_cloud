// ------------------------------------------------------------------
// このファイルを "firebase-config.js" という名前でコピーして使ってください。
// 値は Firebase コンソール →「プロジェクトの設定」→「マイアプリ」→ ウェブアプリの
// 「SDK の設定と構成」に表示される内容をそのまま貼り付ければOKです。
//
// 注意: この apiKey は「秘密鍵」ではありません。Firebaseのウェブアプリでは
// 公開されて問題ない値です（アクセス制御は Firestore のルールで行います）。
// そのため firebase-config.js を GitHub リポジトリに含めてOKです。
// ------------------------------------------------------------------

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// 実証実験の参加者だけがアクセスできるように、簡易的な合言葉を設定できます。
// （強固なセキュリティではありませんが、身内テストの誤アクセス防止には十分です）
// 空文字にすると合言葉なしで誰でも入れます。
export const ACCESS_CODE = "";
