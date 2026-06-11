import { google } from "googleapis";

function getAuthClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON が .env.local に設定されていません。"
    );
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON の JSON パースに失敗しました。フォーマットを確認してください。"
    );
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return auth;
}

export function getSheetsClient() {
  const auth = getAuthClient();
  return google.sheets({ version: "v4", auth });
}

export const SPREADSHEET_ID = process.env.SPREADSHEET_ID!;
