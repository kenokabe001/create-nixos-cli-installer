import dotenv from 'dotenv';
dotenv.config();

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

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

interface DialogueTurn {
  promptRegex: RegExp;
  response: string;
  isPassword?: boolean; // trueの場合、応答をログに出力しない
}

interface ContainerExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  log?: string[]; // 詳細なステップごとのログ
}

async function executeInteractiveScriptInContainer(
  localAI: LocalNixOSAI, // ログ出力用
  scriptToRunInHost: string, // ホスト上のスクリプトパス (例: 'scripts/simple_dialogue.sh')
  dialogueTurns: DialogueTurn[],
  systemdNspawnOptions: string[] = [] // 例: ['--setenv=MY_VAR=value']
): Promise<ContainerExecutionResult> {
  const scriptName = path.basename(scriptToRunInHost);
  let tempContainerDir: string | undefined;
  const executionLog: string[] = [];
  let stdoutData = '';
  let stderrData = '';
  let exitCode: number | null = null;

  localAI.log(LogLevel.INFO, `Starting container execution for script: ${scriptToRunInHost}`);
  executionLog.push(`Starting container execution for script: ${scriptToRunInHost}`);

  try {
    // 1. 一時的なコンテナ用ディレクトリを作成
    tempContainerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nixos_ai_test_'));
    localAI.log(LogLevel.DEBUG, `Created temporary container directory: ${tempContainerDir}`);
    executionLog.push(`Created temporary container directory: ${tempContainerDir}`);

    // 2. スクリプトを一時ディレクトリにコピー
    const scriptInContainerPath = path.join(tempContainerDir, scriptName);
    const scriptContent = await fs.readFile(scriptToRunInHost, 'utf-8');
    await fs.writeFile(scriptInContainerPath, scriptContent, { mode: 0o755 }); // 実行権限付与
    localAI.log(LogLevel.DEBUG, `Copied script to ${scriptInContainerPath} and set executable.`);
    executionLog.push(`Copied script to ${scriptInContainerPath} and set executable.`);

    // 3. systemd-nspawn コマンドを準備
    const spawnArgs = [
      '-D', tempContainerDir,
      ...systemdNspawnOptions,
      `/${scriptName}` // コンテナ内のスクリプトパス
    ];
    localAI.log(LogLevel.INFO, `Executing: sudo systemd-nspawn ${spawnArgs.join(' ')}`);
    executionLog.push(`Executing: sudo systemd-nspawn ${spawnArgs.join(' ')}`);

    // 4. プロセスをspawn
    const child = spawn('sudo', ['systemd-nspawn', ...spawnArgs], {
      stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
    });

    child.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutData += output;
      // localAI.log(LogLevel.DEBUG, `Container STDOUT: ${output.trim()}`); // DEBUGログが多すぎるのでコメントアウト
      executionLog.push(`STDOUT: ${output.trim()}`);
      // TODO: ここでプロンプトを監視し、応答を child.stdin.write() するロジックを追加
    });

    child.stderr.on('data', (data) => {
      const output = data.toString();
      stderrData += output;
      localAI.log(LogLevel.ERROR, `Container STDERR: ${output.trim()}`);
      executionLog.push(`STDERR: ${output.trim()}`);
    });

    return new Promise((resolve) => {
      child.on('close', (code) => {
        exitCode = code;
        localAI.log(LogLevel.INFO, `Container process exited with code: ${code}`);
        executionLog.push(`Container process exited with code: ${code}`);
        resolve({
          success: code === 0,
          stdout: stdoutData,
          stderr: stderrData,
          exitCode: code,
          log: executionLog
        });
      });

      child.on('error', (err) => {
        localAI.log(LogLevel.ERROR, `Failed to start container process: ${err.message}`);
        executionLog.push(`Failed to start container process: ${err.message}`);
        resolve({
          success: false,
          stdout: stdoutData,
          stderr: stderrData + `
Process spawn error: ${err.message}`,
          exitCode: null,
          log: executionLog
        });
      });

       if (dialogueTurns.length === 0) {
        child.stdin.end();
       }
    });

  } catch (error: any) {
    localAI.log(LogLevel.ERROR, `Error in executeInteractiveScriptInContainer: ${error.message}`);
    executionLog.push(`Error in executeInteractiveScriptInContainer: ${error.message}`);
    return {
      success: false,
      stdout: stdoutData,
      stderr: stderrData + `
Outer try-catch error: ${error.message}`,
      exitCode: exitCode,
      log: executionLog
    };
  } finally {
    if (tempContainerDir) {
      try {
        await fs.rm(tempContainerDir, { recursive: true, force: true });
        localAI.log(LogLevel.DEBUG, `Cleaned up temporary directory: ${tempContainerDir}`);
      } catch (cleanupError: any) {
        localAI.log(LogLevel.ERROR, `Failed to clean up temporary directory ${tempContainerDir}: ${cleanupError.message}`);
      }
    }
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
        description: `指定されたパスにあるファイルとディレクトリの一覧を返します。通常は相対パスです (例: ".", "src/components")。`,
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            path : {
              type: SchemaType.STRING,
              description: `一覧表示するディレクトリのパス。通常は相対パスです (例: ".", "src/components")。`
            }
          },
          required: ["path"]
        }
      },
      // TODO: ここに executeInteractiveScriptInContainer をGemini Toolとして登録する定義を追加する
    ]
  }];

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    tools: tools,
  });

  const chat = model.startChat({});
  const localAI = new LocalNixOSAI(chat);
  
  console.log("## Local NixOS AI Builder - Action Log Start ##");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("NixOS AI インストーラビルダーへようこそ。目的を入力してください。終了するには 'exit' または 'quit' と入力してください。");
  console.log("例: 「カレントディレクトリのファイルをリストして」");

  // Test call to executeInteractiveScriptInContainer (example)
  executeInteractiveScriptInContainer( // コメント解除
    localAI,
    'scripts/simple_dialogue.sh',
    [] // dialogueTurns は空で渡す
  ).then(result => {
    localAI.log(LogLevel.INFO, "Container execution finished (non-interactive test).", result);
  }).catch(error => { // エラーハンドリングも追加
    localAI.log(LogLevel.ERROR, "Container execution test failed.", error);
  });

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
            // ... (existing list_project_files logic)
             const pathArg = (funcCall.args as any).path as string;
            if (typeof pathArg !== 'string') {
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
              localAI.log(LogLevel.INFO, `Simulating tool call for list_project_files with path: "${pathArg}"`);
              responses.push({
                functionResponse: {
                  name: "list_project_files",
                  response: { success: true, message: `Tool call for 'list_project_files' for path '${pathArg}' was invoked. The IDE will provide the actual result.` }
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
          } else if (funcCall.name === "executeInteractiveScriptInContainer_TODO") {
             // TODO: Implement the actual call to executeInteractiveScriptInContainer
             // const scriptPathArg = (funcCall.args as any).scriptPath;
             // const dialogueTurnsArg = (funcCall.args as any).dialogueTurns;
             // const result = await executeInteractiveScriptInContainer(localAI, scriptPathArg, dialogueTurnsArg);
             // responses.push({ functionResponse: { name: funcCall.name, response: result }});
             responses.push({ functionResponse: { name: funcCall.name, response: { success: false, message: "Not implemented yet"}}});
          }else {
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
  console.log("## Local NixOS AI Builder - Action Log End ##");
}

run();
