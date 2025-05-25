import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold, ChatSession } from "@google/generative-ai";
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import dotenv from 'dotenv';

dotenv.config();

const MODEL_NAME = "gemini-1.5-flash-latest"; // "gemini-pro" も利用可能です
const API_KEY = process.env.GEMINI_API_KEY;

async function runChat() {
  if (!API_KEY) {
    console.error("エラー: GEMINI_API_KEY が .env ファイルに設定されていません。");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const generationConfig = {
    temperature: 0.9,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
  };

  const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ];

  const chat: ChatSession = model.startChat({
    generationConfig,
    safetySettings,
    history: [], // 必要に応じて会話履歴を初期化できます
  });

  const rl = readline.createInterface({ input, output });
  console.log(`Gemini AI (${MODEL_NAME}) とのチャットを開始します。終了するには 'exit' または 'quit' と入力してください。`);

  while (true) {
    const userInput = await rl.question("あなた: ");

    if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
      console.log("チャットを終了します。");
      rl.close();
      break;
    }

    try {
      const result = await chat.sendMessage(userInput);
      const response = result.response;
      console.log(`Gemini: ${response.text()}`);
    } catch (error) {
      console.error("Gemini APIとの通信中にエラーが発生しました:", error);
      // エラー発生後もチャットを継続するか、ここでループを抜けるかを選択できます
    }
  }
}

runChat().catch(console.error);