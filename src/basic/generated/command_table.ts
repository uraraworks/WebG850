// 自動生成ファイル。手で編集しないこと。
// 生成元: docs/spec/basic_commands.yaml / docs/spec/basic_tokens.yaml
// 生成コマンド: npm run gen (tools/gen_command_table.mjs)
//
// yaml に無いが実装上必要な例外（AUTO の予約語登録、POIPUT/PIOPUT の表記差など）は
// ここには含めない。呼び出し側 (src/basic/token.ts, src/basic/parser.ts) で
// 理由つきの例外リストとして別管理する。

/** basic_tokens.yaml の予約語表（141件、yaml記載順）。 */
export const TOKEN_KEYWORDS: readonly string[] = ["MON","RUN","NEW","CONT","PASS","LIST","LLIST","CLOAD","RENUM","LOAD","DELETE","FILES","LCOPY","CSAVE","OPEN","CLOSE","SAVE","RANDOMIZE","DEGREE","RADIAN","GRAD","BEEP","WAIT","GOTO","TRON","TROFF","CLEAR","USING","DIM","CALL","POKE","GPRINT","PSET","PRESET","ERASE","LFILES","KILL","OUT","PIOSET","POIPUT","SPOUT","SPINP","HDCOPY","ENDIF","REPEAT","UNTIL","CLS","LOCATE","TO","STEP","THEN","ON","IF","FOR","LET","REM","END","NEXT","STOP","READ","DATA","PRINT","INPUT","GOSUB","LNINPUT","LPRINT","RETURN","RESTORE","GCURSOR","LINE","CIRCLE","PAINT","OUTPUT","APPEND","AS","ELSE","WHILE","WEND","SWITCH","CASE","DEFAULT","ENDSWITCH","MDF","REC","POL","TEN","RCP","SQU","CUR","HSN","HCS","HTN","AHS","AHC","AHT","FACT","LN","LOG","EXP","SQR","SIN","COS","TAN","INT","ABS","SGN","DEG","DMS","ASN","ACS","ATN","RND","AND","OR","NOT","PEEK","XOR","INP","PIOGET","POINT","PI","FRE","EOF","LOF","NCR","NPR","CUB","MOD","FIX","ASC","VAL","LEN","VDEG","INKEY$","MID$","LEFT$","RIGHT$","CHR$","STR$","HEX$","DMS$"];

export type CommandPhase = 1 | 2 | 3;

export interface GeneratedFunctionSpec {
  readonly name: string;
  readonly phase: CommandPhase;
  /** true なら括弧・引数を取らない（PI, FRE, MDF, INKEY$, PIOGET）。 */
  readonly noParen: boolean;
  /** format の丸括弧内をトップレベルのカンマで数えた引数の個数（noParen なら 0）。 */
  readonly argCount: number;
}

/** basic_commands.yaml の kind: function 全命令（54件）。phase・noParen・argCount も yaml から機械導出。 */
export const GENERATED_FUNCTIONS: readonly GeneratedFunctionSpec[] = [
  { name: "ABS", phase: 1, noParen: false, argCount: 1 },
  { name: "ACS", phase: 1, noParen: false, argCount: 1 },
  { name: "AHC", phase: 1, noParen: false, argCount: 1 },
  { name: "AHS", phase: 1, noParen: false, argCount: 1 },
  { name: "AHT", phase: 1, noParen: false, argCount: 1 },
  { name: "ASC", phase: 1, noParen: false, argCount: 1 },
  { name: "ASN", phase: 1, noParen: false, argCount: 1 },
  { name: "ATN", phase: 1, noParen: false, argCount: 1 },
  { name: "CHR$", phase: 1, noParen: false, argCount: 1 },
  { name: "COS", phase: 1, noParen: false, argCount: 1 },
  { name: "CUB", phase: 1, noParen: false, argCount: 1 },
  { name: "CUR", phase: 1, noParen: false, argCount: 1 },
  { name: "DEG", phase: 1, noParen: false, argCount: 1 },
  { name: "DMS", phase: 1, noParen: false, argCount: 1 },
  { name: "DMS$", phase: 1, noParen: false, argCount: 1 },
  { name: "EOF", phase: 3, noParen: false, argCount: 1 },
  { name: "EXP", phase: 1, noParen: false, argCount: 1 },
  { name: "FACT", phase: 1, noParen: false, argCount: 1 },
  { name: "FIX", phase: 1, noParen: false, argCount: 1 },
  { name: "FRE", phase: 1, noParen: true, argCount: 0 },
  { name: "HCS", phase: 1, noParen: false, argCount: 1 },
  { name: "HEX$", phase: 1, noParen: false, argCount: 1 },
  { name: "HSN", phase: 1, noParen: false, argCount: 1 },
  { name: "HTN", phase: 1, noParen: false, argCount: 1 },
  { name: "INKEY$", phase: 1, noParen: true, argCount: 0 },
  { name: "INP", phase: 2, noParen: false, argCount: 1 },
  { name: "INT", phase: 1, noParen: false, argCount: 1 },
  { name: "LEFT$", phase: 1, noParen: false, argCount: 2 },
  { name: "LEN", phase: 1, noParen: false, argCount: 1 },
  { name: "LN", phase: 1, noParen: false, argCount: 1 },
  { name: "LOF", phase: 3, noParen: false, argCount: 1 },
  { name: "LOG", phase: 1, noParen: false, argCount: 1 },
  { name: "MDF", phase: 1, noParen: true, argCount: 0 },
  { name: "MID$", phase: 1, noParen: false, argCount: 3 },
  { name: "NCR", phase: 1, noParen: false, argCount: 2 },
  { name: "NPR", phase: 1, noParen: false, argCount: 2 },
  { name: "PEEK", phase: 2, noParen: false, argCount: 1 },
  { name: "PI", phase: 1, noParen: true, argCount: 0 },
  { name: "PIOGET", phase: 2, noParen: true, argCount: 0 },
  { name: "POINT", phase: 1, noParen: false, argCount: 2 },
  { name: "POL", phase: 1, noParen: false, argCount: 2 },
  { name: "RCP", phase: 1, noParen: false, argCount: 1 },
  { name: "REC", phase: 1, noParen: false, argCount: 2 },
  { name: "RIGHT$", phase: 1, noParen: false, argCount: 2 },
  { name: "RND", phase: 1, noParen: false, argCount: 1 },
  { name: "SGN", phase: 1, noParen: false, argCount: 1 },
  { name: "SIN", phase: 1, noParen: false, argCount: 1 },
  { name: "SQR", phase: 1, noParen: false, argCount: 1 },
  { name: "SQU", phase: 1, noParen: false, argCount: 1 },
  { name: "STR$", phase: 1, noParen: false, argCount: 1 },
  { name: "TAN", phase: 1, noParen: false, argCount: 1 },
  { name: "TEN", phase: 1, noParen: false, argCount: 1 },
  { name: "VAL", phase: 1, noParen: false, argCount: 1 },
  { name: "VDEG", phase: 1, noParen: false, argCount: 1 },
];

export interface GeneratedStatementPhaseSpec {
  readonly name: string;
  readonly phase: 2 | 3;
}

/**
 * basic_commands.yaml の kind: statement/command のうち phase 2/3 の命令で、
 * かつ basic_tokens.yaml に同名の予約語が実在するもの。
 *
 * yaml 上は phase 2/3 だが除外される命令（単独の予約語ではない、または
 * 未実装で tokens.yaml に対応する項目が無いもの）:
 * - BLOAD
 * - BLOAD ?
 * - BLOAD M
 * - BSAVE
 * - BSAVE M
 * - INPUT#
 * - LNINPUT#
 * - PIOPUT
 * - PRINT#
 * - PRINT->LPRINT
 */
export const GENERATED_STATEMENT_PHASES: readonly GeneratedStatementPhaseSpec[] = [
  { name: "CALL", phase: 2 },
  { name: "CLOAD", phase: 3 },
  { name: "CLOSE", phase: 3 },
  { name: "CSAVE", phase: 3 },
  { name: "FILES", phase: 3 },
  { name: "HDCOPY", phase: 3 },
  { name: "KILL", phase: 3 },
  { name: "LFILES", phase: 3 },
  { name: "LLIST", phase: 3 },
  { name: "LOAD", phase: 3 },
  { name: "LPRINT", phase: 3 },
  { name: "MON", phase: 2 },
  { name: "OPEN", phase: 3 },
  { name: "OUT", phase: 2 },
  { name: "PIOSET", phase: 2 },
  { name: "POKE", phase: 2 },
  { name: "SAVE", phase: 3 },
  { name: "SPINP", phase: 3 },
  { name: "SPOUT", phase: 3 },
];
