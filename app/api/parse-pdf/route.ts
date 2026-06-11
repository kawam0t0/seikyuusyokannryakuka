import { NextRequest, NextResponse } from "next/server";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

// PDFはフォームデータで受け取り、ここでBase64変換+Gemini解析まで完結させる。
// Server Action に大きなBase64を渡すと "Maximum array nesting exceeded" になるためAPIルートで処理する。

const HirockRowSchema = z.object({
  rows: z.array(
    z.object({
      date: z.string(),
      storeName: z.string(),
      itemName: z.string(),
      quantity: z.number(),
      unitPrice: z.number(),
      total: z.number(),
    })
  ),
});

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const storeName = (formData.get("storeName") as string) ?? "";
    const period = (formData.get("period") as string) ?? "";

    if (!file) {
      return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GOOGLE_GENERATIVE_AI_API_KEY が設定されていません" }, { status: 500 });
    }

    // PDFをBase64に変換
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    const google = createGoogleGenerativeAI({ apiKey });

    const prompt = `このPDFは請求書または納品書です。商品・品目ごとの明細データをすべて抽出してください。

ヒント:
- 店舗名: ${storeName || "不明"}
- 対象期間: ${period || "不明"}

ルール:
- 日付はYYYY-MM-DD形式。文書の日付や納品日を使用。
- 店舗名が文書にない場合はヒントの店舗名を使用。
- 数量・単価・合計が不明な場合は0。
- 1行1品目。合計行・小計行・消費税行・ヘッダー行は除外。`.trim();

    const result = await generateObject({
      model: google("gemini-2.5-flash"),
      schema: HirockRowSchema,
      messages: [
        {
          role: "user",
          content: [
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { type: "file", data: base64, mediaType: "application/pdf" } as any,
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    return NextResponse.json({ rows: result.object.rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "PDF解析に失敗しました";
    console.error("[v0] parse-pdf error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// App Router では config export は不要。bodySizeLimit は next.config.mjs の serverActions.bodySizeLimit で設定済み。
