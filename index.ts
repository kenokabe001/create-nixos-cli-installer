
import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  ChatSession,
  Part,
  Tool,
  SchemaType // Added SchemaType
} from "@google/generative-ai";
import readline from "readline/promises";

const MODEL_NAME = "gemini-1.5-flash-latest";

enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
}

class LocalNixOSAI {
  private actionLog: LogEntry[] = [];
  private chatSession?: ChatSession;

  constructor(chatSession?: ChatSession) {
    this.chatSession = chatSession;
    this.log(LogLevel.INFO, "LocalNixOSAI instance created.");
  }

  public log(level: LogLevel, message: string, data?: any): void {
    const entry: LogEntry = {
      level,
      message: data ? `${message} Data: ${JSON.stringify(data, null, 2)}` : message,
      timestamp: new Date(),
    };
    this.actionLog.push(entry);
    console.log(`[${entry.timestamp.toISOString()}] [LocalAI:${level}] ${entry.message}`);
  }

  public async listDirectoryContents(path: string): Promise<string[]> {
    this.log(LogLevel.WARN, `listDirectoryContents for '${path}' relies on the caller to provide data via an external tool call.`);
    return [];
  }

  public async readFileContent(path: string): Promise<string> {
    this.log(LogLevel.WARN, `readFileContent for '${path}' relies on the caller to provide data via an external tool call.`);
    return "";
  }
  public async performInitialAnalysis(
    templateDirContents: string[],
    installScriptContent: string
  ): Promise<void> {
    this.log(LogLevel.INFO, "Starting initial analysis of the reference project (with provided data)...");
    if (templateDirContents.length > 0) {
      this.log(LogLevel.INFO, `Received ${templateDirContents.length} potential template file paths. First few:`, templateDirContents.slice(0,3));
    } else {
      this.log(LogLevel.WARN, `No template file paths provided. Analysis might be limited.`);
    }
    if (installScriptContent) {
      this.log(LogLevel.INFO, `Received install script content (length: ${installScriptContent.length}).`);
      const moduleTemplatesRegex = /declare -a module_templates=\(\s*([\s\S]*?)\s*\)/m;
      const match = installScriptContent.match(moduleTemplatesRegex);
      if (match && match[1]) {
          this.log(LogLevel.DEBUG, "Successfully found 'module_templates' declaration pattern.");
      } else {
          this.log(LogLevel.INFO, "Could not find 'module_templates' declaration pattern in the provided script content.");
      }
    } else {
      this.log(LogLevel.WARN, `No install script content provided. Analysis will be incomplete.`);
    }
    this.log(LogLevel.INFO, "Initial analysis phase with provided data complete.");
  }
  public getFullActionLog(): LogEntry[] {
    return this.actionLog;
  }
}


// --- Main Chat Application Logic ---
async function run() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable not set.");
    process.exit(1);
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const tools: Tool[] = [{
    functionDeclarations: [
      {
        name: "list_project_files",
        description: "指定されたパスにあるファイルとディレクトリの一覧を返します。",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path : {
              type: SchemaType.STRING,
              description: "一覧表示するディレクトリのパス。通常は相対パスです (例: \\\".\\\", \\\"src/components\\\")。"
            }
          },
          required: ["path"]
        }
      },
    ]
  }];

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    tools: tools,
  });

  const chat = model.startChat({});
  const localAI = new LocalNixOSAI(chat);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("NixOS AI インストーラビルダーへようこそ。目的を入力してください。終了するには 'exit' または 'quit' と入力してください。");
  console.log("例: 「カレントディレクトリのファイルをリストして」");

  while (true) {
    const userInput = await rl.question("あなた: ");

    if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "quit") {
      localAI.log(LogLevel.INFO, "User requested to exit.");
      console.log("チャットを終了します。");
      rl.close();
      break;
    }

    try {
      localAI.log(LogLevel.INFO, `User input: "${userInput}"`);
      const result = await chat.sendMessage(userInput);
      const response = result.response;

      const functionCalls = response.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        localAI.log(LogLevel.INFO, `Received ${functionCalls.length} function call(s) from Gemini.`);
        const responses: Part[] = [];

        for (const funcCall of functionCalls) {
          localAI.log(LogLevel.DEBUG, `Processing function call: ${funcCall.name}`, funcCall.args);
          if (funcCall.name === "list_project_files") {
            const path = (funcCall.args as any).path as string;
            if (typeof path !== 'string') {
                responses.push({
                    functionResponse: {
                        name: "list_project_files",
                        response: { error: "Invalid 'path' argument. It must be a string." }
                    }
                });
                localAI.log(LogLevel.ERROR, "Function call 'list_project_files' failed: Invalid path argument.");
                continue;
            }
            try {
              localAI.log(LogLevel.INFO, `Simulating tool call for list_project_files with path: "${path}"`);
              responses.push({
                functionResponse: {
                  name: "list_project_files",
                  response: { success: true, message: `Tool call for 'list_project_files' for path '${path}' was invoked. The IDE will provide the actual result.` }
                }
              });

            } catch (e: any) {
              localAI.log(LogLevel.ERROR, `Error during simulated tool call for list_project_files: ${e.message}`);
              responses.push({
                functionResponse: {
                  name: "list_project_files",
                  response: { error: `Failed to execute list_project_files: ${e.message}` }
                }
              });
            }
          } else {
            localAI.log(LogLevel.WARN, `Unsupported function call: ${funcCall.name}`);
            responses.push({
                functionResponse: {
                    name: funcCall.name,
                    response: { error: `Unsupported function '${funcCall.name}'` }
                }
            });
          }
        }
        if (responses.length > 0) {
            const sent = await chat.sendMessage(responses);
            localAI.log(LogLevel.DEBUG, "Sent function responses to Gemini. Waiting for next model response.");
            const nextResponse = sent.response;
            console.log(`Gemini (after function call): ${nextResponse.text()}`);
            localAI.log(LogLevel.INFO, `Gemini response after function call: "${nextResponse.text()}"`);
        }

      } else {
        const responseText = response.text();
        console.log(`Gemini: ${responseText}`);
        localAI.log(LogLevel.INFO, `Gemini response: "${responseText}"`);
      }

    } catch (error: any) {
      console.error("Gemini APIとの通信中または処理中にエラーが発生しました:", error.message);
      localAI.log(LogLevel.ERROR, `Error during chat processing: ${error.message}`);
    }
  }
}

run();
